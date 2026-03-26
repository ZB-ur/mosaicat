import type { AgentContext, StageName } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { LLMProvider } from '../core/llm-provider.js';
import type { Logger } from '../core/logger.js';
import type { InteractionHandler } from '../core/interaction-handler.js';
import type { OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import { writeArtifact, readArtifact, artifactExists, getArtifactsDir } from '../core/artifact.js';
import { logRetry, classifyError } from '../core/retry-log.js';
import { CoderPlanner } from './coder/coder-planner.js';
import { CoderBuilder } from './coder/coder-builder.js';
import { BuildVerifier, AUTO_FIX_RETRIES } from './coder/build-verifier.js';
import { SmokeRunner } from './coder/smoke-runner.js';
import { OutputGenerator } from './coder/output-generator.js';
import type { CoderDeps, ArtifactIO } from './coder/types.js';

/**
 * High-autonomy Coder Agent -- thin facade delegating to sub-modules.
 *
 * Flow:
 * 1. Plan (CoderPlanner) -> code-plan.json
 * 2. Skeleton (CoderBuilder) -> all files with stub implementations
 * 3. Setup + verify skeleton (BuildVerifier)
 * 4. Implement per-module (CoderBuilder) with verify-fix loop (BuildVerifier)
 * 5. Final build (BuildVerifier) + acceptance tests
 * 6. Build artifact analysis (BuildVerifier) + smoke test (SmokeRunner)
 * 7. Generate manifest + README
 */
export class CoderAgent extends BaseAgent {
  private interactionHandler?: InteractionHandler;

  constructor(
    stage: StageName,
    provider: LLMProvider,
    logger: Logger,
    interactionHandler?: InteractionHandler,
  ) {
    super(stage, provider, logger);
    this.interactionHandler = interactionHandler;
  }

  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['code/'],
      manifest: 'code.manifest.json',
    };
  }

  /** Bridge module-level artifact functions to ArtifactIO interface for sub-modules. */
  private createArtifactIO(): ArtifactIO {
    return {
      write: writeArtifact,
      read: readArtifact,
      exists: artifactExists,
      getDir: getArtifactsDir,
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const autonomy = context.task.autonomy;
    const totalBudget = autonomy?.max_budget_usd ?? 5;
    const testFailures = context.inputArtifacts.get('test_failures');

    const artifacts = this.createArtifactIO();
    const deps: CoderDeps = {
      stage: this.stage,
      provider: this.provider,
      artifacts,
      logger: this.logger,
      eventBus,
    };

    const planner = new CoderPlanner(deps);
    const builder = new CoderBuilder(deps);
    const verifier = new BuildVerifier({ ...deps, interactionHandler: this.interactionHandler });
    const smoker = new SmokeRunner({ stage: this.stage, artifacts, logger: this.logger, eventBus });

    // Step 1: Get or create code plan
    const plan = planner.loadExistingPlan() ?? await planner.createPlan(context);

    // Step 2: Skeleton phase
    if (builder.isSkeletonComplete(plan)) {
      this.logger.agent(this.stage, 'info', 'skeleton:reuse', {
        message: 'All skeleton files exist on disk -- skipping skeleton phase',
      });
      eventBus.emit('agent:progress', this.stage, 'skeleton: reusing existing files (retry scenario)');
    } else {
      await builder.runSkeleton(context, plan);
    }

    // Step 3: Setup (npm install)
    eventBus.emit('agent:progress', this.stage, `running: ${plan.commands.setupCommand}`);
    verifier.runSetupCommand(plan);

    // Step 4: Verify skeleton
    eventBus.emit('agent:progress', this.stage, `verifying skeleton: ${plan.commands.verifyCommand}`);
    const skeletonVerify = verifier.runVerifyCommand(plan);
    if (skeletonVerify.success) {
      eventBus.emit('agent:progress', this.stage, 'skeleton: tsc passed');
    } else {
      eventBus.emit('agent:progress', this.stage, 'skeleton: tsc failed -- attempting fix...');
      this.logger.agent(this.stage, 'warn', 'skeleton:verify-failed', {
        errors: skeletonVerify.errors.slice(0, 1000),
      });
      await builder.runSkeletonFix(context, plan, skeletonVerify.errors, totalBudget * 0.15);
    }

    // Step 5: Implement phase -- per-module with verify-fix loop
    const modulesToImplement = builder.getModulesToImplement(plan, testFailures);

    if (modulesToImplement.length === 0) {
      this.logger.agent(this.stage, 'info', 'implement:all-modules-complete', {
        totalModules: plan.modules.length,
      });
    } else {
      const builderBudget = totalBudget - 0.50 - 2.00; // PLANNER_BUDGET - SKELETON_BUDGET
      const perModuleBudget = modulesToImplement.length > 0
        ? builderBudget / modulesToImplement.length
        : builderBudget;

      // Build scaffold first if in the implement list
      const scaffoldModule = modulesToImplement.find(m => m.priority === 0);
      if (scaffoldModule) {
        eventBus.emit('agent:progress', this.stage, `[scaffold] implementing ${scaffoldModule.files.length} files...`);
        await builder.implementModule(context, plan, scaffoldModule, perModuleBudget);
        eventBus.emit('agent:progress', this.stage, `[scaffold] running: ${plan.commands.setupCommand}`);
        verifier.runSetupCommand(plan);
      }

      // Implement remaining modules by priority
      const nonScaffold = modulesToImplement
        .filter(m => m.priority !== 0)
        .sort((a, b) => a.priority - b.priority);

      for (let mi = 0; mi < nonScaffold.length; mi++) {
        const mod = nonScaffold[mi];
        eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] implementing "${mod.name}" -- ${mod.files.length} files`);
        await builder.implementModule(context, plan, mod, perModuleBudget);

        // Verify after each module
        eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] verifying: ${plan.commands.verifyCommand}`);
        const verifyResult = verifier.runVerifyCommand(plan);
        if (verifyResult.success) {
          eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] verify passed`);
        } else {
          eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] verify failed -- attempting fix...`);
          let fixed = false;
          let lastErrors = verifyResult.errors;
          for (let retry = 1; ; retry++) {
            if (retry > AUTO_FIX_RETRIES) {
              const shouldContinue = await verifier.askUserToRetry(mod.name, retry - 1, lastErrors);
              if (!shouldContinue) {
                eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] user chose to skip -- continuing`);
                break;
              }
            }

            eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] fix attempt ${retry}...`);
            this.logger.agent(this.stage, 'warn', 'implement:verify-failed', {
              module: mod.name,
              retry,
              errors: lastErrors.slice(0, 500),
            });

            logRetry({
              timestamp: new Date().toISOString(),
              runId: context.task.runId,
              stage: this.stage,
              source: 'coder-module-fix',
              attempt: retry,
              errorCategory: classifyError(lastErrors),
              errorMessage: lastErrors,
              resolved: false,
              module: mod.name,
            });

            await builder.implementModuleWithErrors(
              context, plan, mod, perModuleBudget, lastErrors, retry,
            );

            const retryResult = verifier.runVerifyCommand(plan);
            if (retryResult.success) {
              eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] fix succeeded (attempt ${retry})`);
              fixed = true;
              break;
            }
            lastErrors = retryResult.errors;
          }

          if (!fixed) {
            this.logger.agent(this.stage, 'warn', 'implement:verify-gave-up', {
              module: mod.name,
            });
          }
        }
      }
    }

    // Step 6: Final build
    eventBus.emit('agent:progress', this.stage, `running final build: ${plan.commands.buildCommand}`);
    const buildResult = verifier.runBuildCommand(plan);
    if (buildResult.success) {
      eventBus.emit('agent:progress', this.stage, 'build passed');
    } else {
      eventBus.emit('agent:progress', this.stage, 'build failed -- attempting fix...');
      this.logger.agent(this.stage, 'warn', 'build:failed', {
        errors: buildResult.errors.slice(0, 1000),
      });
      await verifier.runBuildFix(context, plan, buildResult.errors, totalBudget * 0.2);
    }

    // Step 7: Acceptance tests
    await verifier.runAcceptanceTests(context, plan, totalBudget * 0.2);

    // Step 8: Build artifact analysis
    verifier.analyzeBuildArtifacts(plan);

    // Step 9: Smoke test
    await smoker.runSmokeTest(plan);

    // Step 10: Generate manifest + README
    const output = new OutputGenerator(this.stage, this.logger, {
      writeOutput: (name, content) => this.writeOutput(name, content),
      writeOutputManifest: (name, data) => this.writeOutputManifest(name, data),
    });
    output.generateManifest(plan);
    output.generateReadme(plan);
  }
}
