// GTO Idiot - Game Orchestration Service

import { db } from '../db/database';
import { sessionService } from './session-service';
import { handHistoryService } from './hand-history-service';
import { createDeck, shuffleDeck, dealCards } from '../engine/deck';
import { resolveShowdown } from '../engine/showdown';
import { BotEngine } from '../bot/bot-engine';
import type { BotDecisionRequest } from '../bot/bot-engine';
import type {
  GameState,
  ActionResult,
  ActionType,
  Action,
  BotActionEvent,
  StreetTransition,
  Player,
  Position,
  Street,
  Card,
  AvailableAction,
  StreetData,
  HandResult,
  PotInfo,
} from '../engine/types';
import type { HandRecord } from '../db/schema';

const POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river'];

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function getNextStreet(current: Street): Street | null {
  const idx = STREET_ORDER.indexOf(current);
  if (idx < 0 || idx >= STREET_ORDER.length - 1) return null;
  return STREET_ORDER[idx + 1]!;
}

function assignPositions(
  players: Player[],
  dealerSeatIndex: number,
): Player[] {
  const count = players.length;
  return players.map((p) => {
    const offset = (p.seatIndex - dealerSeatIndex + count) % count;
    // For 6-max: BTN=0, SB=1, BB=2, UTG=3, HJ=4, CO=5
    const positionMap: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
    return {
      ...p,
      position: positionMap[offset]!,
      isActive: !p.isBusted && p.chips > 0,
      currentBet: 0,
    };
  });
}

function computeAvailableActions(
  state: GameState,
  playerSeatIndex: number,
): AvailableAction[] {
  const player = state.players.find((p) => p.seatIndex === playerSeatIndex);
  if (!player || !player.isActive) return [];

  const currentStreetActions = state.actions.filter(
    (a) => a.street === state.street,
  );
  const highestBet = Math.max(
    0,
    ...state.players.map((p) => p.currentBet ?? 0),
  );
  const playerBet = player.currentBet ?? 0;
  const toCall = highestBet - playerBet;
  const minRaise = Math.max(highestBet * 2, 2); // At least 2BB or double
  const actions: AvailableAction[] = [];

  // Fold is always available if there's a bet to face
  if (toCall > 0) {
    actions.push({ actionType: 'fold' });
  }

  // Check is available if no bet to face
  if (toCall === 0) {
    actions.push({ actionType: 'check' });
  }

  // Call is available if there's a bet to face
  if (toCall > 0 && player.chips >= toCall) {
    actions.push({ actionType: 'call', minAmount: toCall, maxAmount: toCall });
  }

  // Raise is available if player has enough chips
  if (player.chips > toCall) {
    actions.push({
      actionType: 'raise',
      minAmount: Math.min(minRaise, player.chips),
      maxAmount: player.chips,
    });
  }

  // All-in is always available
  if (player.chips > 0) {
    actions.push({
      actionType: 'all_in',
      minAmount: player.chips,
      maxAmount: player.chips,
    });
  }

  return actions;
}

function isStreetComplete(state: GameState): boolean {
  const activePlayers = state.players.filter(
    (p) => p.isActive && !p.isBusted,
  );

  // Only one player left (everyone else folded)
  if (activePlayers.length <= 1) return true;

  const streetActions = state.actions.filter((a) => a.street === state.street);
  if (streetActions.length === 0) return false;

  // All active players must have acted at least once
  const actedPlayers = new Set(streetActions.map((a) => a.playerSeatIndex));
  const playersNeedingAction = activePlayers.filter(
    (p) => !actedPlayers.has(p.seatIndex),
  );
  if (playersNeedingAction.length > 0) return false;

  // All bets must be equal (or player is all-in)
  const highestBet = Math.max(
    0,
    ...activePlayers.map((p) => p.currentBet ?? 0),
  );

  const allBetsEqual = activePlayers.every(
    (p) =>
      (p.currentBet ?? 0) === highestBet ||
      p.chips === 0, // all-in
  );

  return allBetsEqual;
}

function isHandComplete(state: GameState): boolean {
  const activePlayers = state.players.filter(
    (p) => p.isActive && !p.isBusted,
  );
  if (activePlayers.length <= 1) return true;
  if (state.street === 'river' && isStreetComplete(state)) return true;
  return false;
}

function getNextActivePlayer(
  state: GameState,
  afterSeatIndex: number,
): number {
  const count = state.players.length;
  for (let i = 1; i <= count; i++) {
    const idx = (afterSeatIndex + i) % count;
    const player = state.players[idx]!;
    if (player.isActive && !player.isBusted && player.chips > 0) {
      return idx;
    }
  }
  return -1;
}

const botEngine = new BotEngine();

/**
 * Delegates bot decisions to the real BotEngine, building a proper
 * BotDecisionRequest from the current game state.
 */
function decideBotAction(
  state: GameState,
  seatIndex: number,
): { actionType: ActionType; amount?: number } {
  const player = state.players[seatIndex]!;

  // If the bot has no hole cards or no style, fall back to fold/check
  if (!player.holeCards || !player.botStyle) {
    const canCheck = (Math.max(0, ...state.players.map((p) => p.currentBet ?? 0)) - (player.currentBet ?? 0)) === 0;
    return { actionType: canCheck ? 'check' : 'fold' };
  }

  const opponentStacks = state.players
    .filter((p) => p.seatIndex !== seatIndex && p.isActive && !p.isBusted)
    .map((p) => p.chips);

  const request: BotDecisionRequest = {
    botStyle: player.botStyle,
    holeCards: player.holeCards,
    position: player.position,
    street: state.street,
    communityCards: state.communityCards,
    potSize: state.pot.mainPot + (state.pot.sidePots?.reduce((sum, sp) => sum + sp.amount, 0) ?? 0),
    actions: state.actions,
    chipStack: player.chips,
    opponentStacks,
  };

  const decision = botEngine.decide(request);

  // Clamp the amount to the player's available chips
  const amount = decision.amount !== undefined
    ? Math.min(decision.amount, player.chips)
    : undefined;

  return { actionType: decision.actionType, amount };
}

function applyAction(
  state: GameState,
  seatIndex: number,
  actionType: ActionType,
  amount?: number,
): void {
  const player = state.players[seatIndex]!;
  const highestBet = Math.max(
    0,
    ...state.players.map((p) => p.currentBet ?? 0),
  );

  const action: Action = {
    playerSeatIndex: seatIndex,
    playerName: player.name,
    actionType,
    amount,
    street: state.street,
    timestamp: Date.now(),
  };

  switch (actionType) {
    case 'fold':
      player.isActive = false;
      break;
    case 'check':
      // No chip movement
      break;
    case 'call': {
      const toCall = highestBet - (player.currentBet ?? 0);
      const actualCall = Math.min(toCall, player.chips);
      player.chips -= actualCall;
      player.currentBet = (player.currentBet ?? 0) + actualCall;
      state.pot.mainPot += actualCall;
      action.amount = actualCall;
      break;
    }
    case 'raise': {
      const raiseAmount = amount ?? highestBet * 2;
      const totalBet = raiseAmount;
      const additional = totalBet - (player.currentBet ?? 0);
      const actualAdditional = Math.min(additional, player.chips);
      player.chips -= actualAdditional;
      player.currentBet = (player.currentBet ?? 0) + actualAdditional;
      state.pot.mainPot += actualAdditional;
      action.amount = totalBet;
      break;
    }
    case 'all_in': {
      const allIn = player.chips;
      player.currentBet = (player.currentBet ?? 0) + allIn;
      state.pot.mainPot += allIn;
      player.chips = 0;
      action.amount = allIn;
      break;
    }
  }

  action.potAfter = state.pot.mainPot;
  state.actions.push(action);
}

function transitionStreet(state: GameState): StreetTransition | null {
  const nextStreet = getNextStreet(state.street);
  if (!nextStreet) return null;

  const previousStreet = state.street;
  state.street = nextStreet;

  // Reset current bets
  for (const p of state.players) {
    p.currentBet = 0;
  }

  // Deal community cards
  let newCards: Card[] = [];
  if (nextStreet === 'flop') {
    const result = dealCards(state.deck, 3);
    newCards = result.dealt;
    state.deck = result.remaining;
  } else if (nextStreet === 'turn' || nextStreet === 'river') {
    const result = dealCards(state.deck, 1);
    newCards = result.dealt;
    state.deck = result.remaining;
  }
  state.communityCards.push(...newCards);

  // Set first active player after dealer
  const dealerIdx = state.dealerSeatIndex;
  // Post-flop, action starts left of dealer (SB position)
  const firstToAct = getNextActivePlayer(state, dealerIdx);
  state.currentPlayerSeatIndex = firstToAct;

  return {
    from: previousStreet,
    to: nextStreet,
    communityCards: [...state.communityCards],
  };
}

function determineResult(state: GameState): HandResult {
  const activePlayers = state.players.filter((p) => p.isActive);

  if (activePlayers.length === 1) {
    // Everyone else folded — no showdown needed
    const winner = activePlayers[0]!;
    const totalPot = state.pot.mainPot
      + (state.pot.sidePots?.reduce((sum, sp) => sum + sp.amount, 0) ?? 0);
    return {
      winners: [
        {
          seatIndex: winner.seatIndex,
          amount: totalPot,
          potType: 'main',
        },
      ],
      handRankings: [],
      showdown: false,
    };
  }

  // Real showdown: evaluate hands, distribute pots
  return resolveShowdown(state.players, state.communityCards, state.pot);
}

class GameService {
  private activeGames: Map<string, GameState> = new Map();

  async dealNewHand(sessionId: string): Promise<GameState> {
    const sessionRecord = await sessionService.getSessionRecord(sessionId);
    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (sessionRecord.status === 'completed') {
      throw new Error(`Session is completed: ${sessionId}`);
    }

    const handId = generateId();
    const deck = shuffleDeck(createDeck());

    // Assign positions based on dealer
    const players = assignPositions(
      sessionRecord.players,
      sessionRecord.dealerSeatIndex,
    );

    // Deal hole cards
    let remainingDeck = deck;
    for (const player of players) {
      if (player.isActive) {
        const result = dealCards(remainingDeck, 2);
        player.holeCards = [result.dealt[0]!, result.dealt[1]!];
        remainingDeck = result.remaining;
      }
    }

    // Post blinds
    const sbPlayer = players.find((p) => p.position === 'SB')!;
    const bbPlayer = players.find((p) => p.position === 'BB')!;
    const smallBlind = 0.5;
    const bigBlind = 1;

    sbPlayer.chips -= smallBlind;
    sbPlayer.currentBet = smallBlind;
    bbPlayer.chips -= bigBlind;
    bbPlayer.currentBet = bigBlind;

    const pot: PotInfo = { mainPot: smallBlind + bigBlind };

    // First to act preflop is UTG
    const utgPlayer = players.find((p) => p.position === 'UTG')!;

    const state: GameState = {
      handId,
      sessionId,
      street: 'preflop',
      players,
      pot,
      communityCards: [],
      actions: [],
      currentPlayerSeatIndex: utgPlayer.seatIndex,
      dealerSeatIndex: sessionRecord.dealerSeatIndex,
      deck: remainingDeck,
      availableActions: [],
    };

    this.activeGames.set(sessionId, state);

    // Update session with current hand
    await db.sessions.update(sessionId, { currentHandId: handId });

    // Auto-play bot actions until it's the human player's turn
    const humanPlayer = state.players.find((p) => p.isHuman);
    const preflopBotActions: BotActionEvent[] = [];

    while (humanPlayer && state.currentPlayerSeatIndex !== humanPlayer.seatIndex) {
      const currentPlayer = state.players[state.currentPlayerSeatIndex];
      if (!currentPlayer || currentPlayer.isHuman || !currentPlayer.isActive || currentPlayer.isBusted) {
        break;
      }

      const botDecision = decideBotAction(state, currentPlayer.seatIndex);
      applyAction(state, currentPlayer.seatIndex, botDecision.actionType, botDecision.amount);

      preflopBotActions.push({
        seatIndex: currentPlayer.seatIndex,
        name: currentPlayer.name,
        botStyle: currentPlayer.botStyle,
        actionType: botDecision.actionType,
        amount: botDecision.amount,
        thinkTimeMs: 300 + Math.floor(Math.random() * 800),
      });

      if (isHandComplete(state)) {
        break;
      }

      state.currentPlayerSeatIndex = getNextActivePlayer(state, currentPlayer.seatIndex);
    }

    // Compute available actions for the (now current) player
    state.availableActions = computeAvailableActions(
      state,
      state.currentPlayerSeatIndex,
    );

    // Attach preflop bot actions for UI animation
    (state as GameState & { preflopBotActions?: BotActionEvent[] }).preflopBotActions = preflopBotActions;

    return state;
  }

  async submitPlayerAction(
    sessionId: string,
    action: { actionType: ActionType; amount?: number },
  ): Promise<ActionResult> {
    const state = this.activeGames.get(sessionId);
    if (!state) {
      throw new Error(`No active game for session: ${sessionId}`);
    }

    const humanPlayer = state.players.find((p) => p.isHuman);
    if (!humanPlayer) {
      throw new Error('No human player found');
    }
    if (state.currentPlayerSeatIndex !== humanPlayer.seatIndex) {
      throw new Error('Not the human player\'s turn');
    }

    // Apply human action
    applyAction(state, humanPlayer.seatIndex, action.actionType, action.amount);

    // Advance to next player after human acts
    state.currentPlayerSeatIndex = getNextActivePlayer(state, humanPlayer.seatIndex);

    const botActions: BotActionEvent[] = [];
    const streetTransitions: StreetTransition[] = [];

    // Advance game state
    let continueProcessing = true;
    while (continueProcessing) {
      if (isHandComplete(state)) {
        // Hand is over
        const result = determineResult(state);
        state.result = result;
        state.isHandComplete = true;

        // Calculate human profit/loss
        const humanWinner = result.winners.find(
          (w) => w.seatIndex === humanPlayer.seatIndex,
        );
        const startingChips = (await sessionService.getSessionRecord(sessionId))
          ?.players.find((p) => p.isHuman)?.chips ?? 0;
        const profitLoss = humanPlayer.chips - startingChips + (humanWinner?.amount ?? 0);

        // Save hand to history
        const streets = this.buildStreetData(state);
        const humanPos = humanPlayer.position;
        const handRecord: HandRecord = {
          id: state.handId,
          sessionId,
          handNumber: 0, // Will be set by session update
          players: state.players.map((p) => ({ ...p })),
          streets,
          result,
          scenarioTags: [],
          profitLossBB: profitLoss,
          dealerSeatIndex: state.dealerSeatIndex,
          humanPosition: humanPos,
          createdAt: new Date(),
        };
        handRecord.scenarioTags = handHistoryService.generateScenarioTags(handRecord);

        await handHistoryService.saveHand(handRecord);
        await sessionService.updateSessionAfterHand(sessionId, result, profitLoss);

        this.activeGames.delete(sessionId);
        continueProcessing = false;
        break;
      }

      if (isStreetComplete(state)) {
        const transition = transitionStreet(state);
        if (transition) {
          streetTransitions.push(transition);
        }
      }

      // Check if next player is a bot
      const nextPlayer = state.players[state.currentPlayerSeatIndex];
      if (!nextPlayer || nextPlayer.isHuman) {
        // It's the human's turn again, stop processing
        state.availableActions = computeAvailableActions(
          state,
          state.currentPlayerSeatIndex,
        );
        continueProcessing = false;
      } else if (nextPlayer.isActive && !nextPlayer.isBusted) {
        // Bot's turn
        const botDecision = decideBotAction(state, nextPlayer.seatIndex);
        applyAction(
          state,
          nextPlayer.seatIndex,
          botDecision.actionType,
          botDecision.amount,
        );

        const thinkTimeMs = 500 + Math.floor(Math.random() * 2000);
        botActions.push({
          seatIndex: nextPlayer.seatIndex,
          name: nextPlayer.name,
          botStyle: nextPlayer.botStyle,
          actionType: botDecision.actionType,
          amount: botDecision.amount,
          thinkTimeMs,
        });

        // Move to next player
        state.currentPlayerSeatIndex = getNextActivePlayer(
          state,
          nextPlayer.seatIndex,
        );
      } else {
        // Skip inactive player
        state.currentPlayerSeatIndex = getNextActivePlayer(
          state,
          state.currentPlayerSeatIndex,
        );
      }
    }

    return {
      gameState: state,
      botActions,
      streetTransitions: streetTransitions.length > 0 ? streetTransitions : undefined,
    };
  }

  async getCurrentState(sessionId: string): Promise<GameState | null> {
    return this.activeGames.get(sessionId) ?? null;
  }

  private buildStreetData(state: GameState): StreetData[] {
    const streets: StreetData[] = [];
    let runningPot = 0;

    for (const street of STREET_ORDER) {
      const streetActions = state.actions.filter((a) => a.street === street);
      if (streetActions.length === 0 && street !== 'preflop') continue;

      const potAtStart = runningPot;
      const potAtEnd =
        streetActions.length > 0
          ? streetActions[streetActions.length - 1]!.potAfter ?? runningPot
          : runningPot;

      let communityCards: Card[] | undefined;
      if (street === 'flop') {
        communityCards = state.communityCards.slice(0, 3);
      } else if (street === 'turn') {
        communityCards = state.communityCards.slice(0, 4);
      } else if (street === 'river') {
        communityCards = [...state.communityCards];
      }

      streets.push({
        street,
        communityCards,
        actions: streetActions,
        potAtStart,
        potAtEnd,
      });

      runningPot = potAtEnd;
    }

    return streets;
  }
}

export const gameService = new GameService();
