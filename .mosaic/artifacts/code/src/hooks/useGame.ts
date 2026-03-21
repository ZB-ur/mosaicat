'use client';

import { useCallback, useRef } from 'react';
import { useGameStore } from '@/store/game-store';
import { useSessionStore } from '@/store/session-store';
import { gameService } from '@/services/game-service';
import type { ActionType, AvailableAction, BotActionEvent, GameState } from '@/engine/types';

const BOT_ACTION_DELAY_MS = 600;

export function useGame() {
  const {
    currentGameState,
    isPlayerTurn,
    isAnimating,
    pendingBotActions,
    error,
    setGameState,
    setPlayerTurn,
    addBotActions,
    clearBotActions,
    setAnimating,
    setError,
  } = useGameStore();

  const currentSession = useSessionStore((s) => s.currentSession);
  const animatingRef = useRef(false);

  const availableActions: AvailableAction[] =
    currentGameState?.availableActions ?? [];

  const animateBotActions = useCallback(async () => {
    const actions = useGameStore.getState().pendingBotActions;
    if (actions.length === 0 || animatingRef.current) return;

    animatingRef.current = true;
    setAnimating(true);

    try {
      for (const botAction of actions) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.max(botAction.thinkTimeMs, BOT_ACTION_DELAY_MS))
        );

        const state = useGameStore.getState().currentGameState;
        if (!state) break;

        const updatedState = {
          ...state,
          actions: [
            ...state.actions,
            {
              playerSeatIndex: botAction.seatIndex,
              playerName: botAction.name,
              actionType: botAction.actionType,
              amount: botAction.amount,
              street: state.street,
              timestamp: Date.now(),
            },
          ],
        };
        setGameState(updatedState);
      }

      clearBotActions();

      const latestState = useGameStore.getState().currentGameState;
      if (latestState && !latestState.isHandComplete) {
        const humanSeatIndex = latestState.players.findIndex((p) => p.isHuman);
        setPlayerTurn(latestState.currentPlayerSeatIndex === humanSeatIndex);
      }
    } finally {
      animatingRef.current = false;
      setAnimating(false);
    }
  }, [setGameState, setAnimating, clearBotActions, setPlayerTurn]);

  const dealNewHand = useCallback(async () => {
    if (!currentSession) return;
    setError(null);
    try {
      const state = await gameService.dealNewHand(currentSession.sessionId);
      setGameState(state);

      // Animate preflop bot actions if any bots acted before the human
      const preflopBotActions = (state as GameState & { preflopBotActions?: BotActionEvent[] }).preflopBotActions;
      if (preflopBotActions && preflopBotActions.length > 0) {
        addBotActions(preflopBotActions);
        // Let the state render first, then animate
        setTimeout(() => animateBotActions(), 50);
      }

      const humanSeatIndex = state.players.findIndex((p) => p.isHuman);
      setPlayerTurn(state.currentPlayerSeatIndex === humanSeatIndex);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deal new hand');
    }
  }, [currentSession, setGameState, setPlayerTurn, setError, addBotActions, animateBotActions]);

  const submitAction = useCallback(
    async (actionType: ActionType, amount?: number) => {
      if (!currentSession) return;
      setError(null);
      setPlayerTurn(false);

      try {
        const result = await gameService.submitPlayerAction(
          currentSession.sessionId,
          { actionType, amount },
        );
        setGameState(result.gameState);

        if (result.botActions.length > 0) {
          addBotActions(result.botActions);
          await animateBotActions();
        } else {
          const humanSeatIndex = result.gameState.players.findIndex(
            (p) => p.isHuman,
          );
          if (!result.gameState.isHandComplete) {
            setPlayerTurn(
              result.gameState.currentPlayerSeatIndex === humanSeatIndex,
            );
          }
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to submit action',
        );
      }
    },
    [
      currentSession,
      setGameState,
      setPlayerTurn,
      addBotActions,
      setError,
      animateBotActions,
    ],
  );

  return {
    gameState: currentGameState,
    isPlayerTurn,
    isAnimating,
    availableActions,
    error,
    dealNewHand,
    submitAction,
    animateBotActions,
  };
}
