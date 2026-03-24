/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, Trophy, User, Circle, Cpu, Globe, Hash, Copy, Check, ArrowLeft, Undo2 } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

const BOARD_SIZE = 15;

type Player = 'black' | 'white';
type CellValue = Player | null;
type GameMode = 'pvp' | 'pvc' | 'online';

export default function App() {
  const [board, setBoard] = useState<CellValue[][]>(
    Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null))
  );
  const [currentPlayer, setCurrentPlayer] = useState<Player>('black');
  const [winner, setWinner] = useState<Player | 'draw' | null>(null);
  const [lastMove, setLastMove] = useState<{ r: number; c: number } | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>('pvc');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [history, setHistory] = useState<{ board: CellValue[][], currentPlayer: Player, lastMove: { r: number; c: number } | null, winner: Player | 'draw' | null }[]>([]);

  // Online Mode States
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [myPlayerColor, setMyPlayerColor] = useState<Player | null>(null);
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const checkWinner = useCallback((board: CellValue[][], row: number, col: number, player: Player) => {
    const directions = [
      [0, 1],  // horizontal
      [1, 0],  // vertical
      [1, 1],  // diagonal \
      [1, -1], // diagonal /
    ];

    for (const [dr, dc] of directions) {
      let count = 1;
      for (let i = 1; i < 5; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) count++;
        else break;
      }
      for (let i = 1; i < 5; i++) {
        const r = row - dr * i;
        const c = col - dc * i;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) count++;
        else break;
      }
      if (count >= 5) return true;
    }
    return false;
  }, []);

  const getCellScore = (board: CellValue[][], r: number, c: number, player: Player) => {
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
    let totalScore = 0;
    for (const [dr, dc] of directions) {
      let count = 1;
      let openEnds = 0;
      for (let i = 1; i < 5; i++) {
        const nr = r + dr * i;
        const nc = c + dc * i;
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
          if (board[nr][nc] === player) count++;
          else if (board[nr][nc] === null) { openEnds++; break; }
          else break;
        } else break;
      }
      for (let i = 1; i < 5; i++) {
        const nr = r - dr * i;
        const nc = c - dc * i;
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
          if (board[nr][nc] === player) count++;
          else if (board[nr][nc] === null) { openEnds++; break; }
          else break;
        } else break;
      }
      if (count >= 5) totalScore += 100000;
      else if (count === 4) totalScore += openEnds === 2 ? 10000 : 1000;
      else if (count === 3) totalScore += openEnds === 2 ? 1000 : 100;
      else if (count === 2) totalScore += openEnds === 2 ? 100 : 10;
    }
    return totalScore;
  };

  const makeMove = useCallback((r: number, c: number, player: Player, isRemote = false) => {
    if (board[r][c] || winner) return;

    // Save current state to history before moving
    setHistory(prev => [...prev, { 
      board: board.map(row => [...row]), 
      currentPlayer, 
      lastMove, 
      winner 
    }]);

    setBoard(prev => {
      const newBoard = prev.map((row, rowIndex) =>
        row.map((cell, colIndex) => (rowIndex === r && colIndex === c ? player : cell))
      );

      if (checkWinner(newBoard, r, c, player)) {
        setWinner(player);
      } else if (newBoard.every(row => row.every(cell => cell !== null))) {
        setWinner('draw');
      } else {
        setCurrentPlayer(player === 'black' ? 'white' : 'black');
      }
      return newBoard;
    });

    setLastMove({ r, c });

    // Send move to server if it's a local move in online mode
    if (!isRemote && gameMode === 'online' && socketRef.current && roomId) {
      socketRef.current.emit('make-move', { roomId, r, c, player });
    }
  }, [board, winner, gameMode, roomId, checkWinner]);

  // AI Turn Logic
  useEffect(() => {
    if (gameMode === 'pvc' && currentPlayer === 'white' && !winner) {
      setIsAiThinking(true);
      const timer = setTimeout(() => {
        let bestScore = -1;
        let bestMove = { r: 7, c: 7 };

        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            if (!board[r][c]) {
              const aiScore = getCellScore(board, r, c, 'white');
              const playerScore = getCellScore(board, r, c, 'black');
              const combinedScore = aiScore * 1.1 + playerScore;

              if (combinedScore > bestScore) {
                bestScore = combinedScore;
                bestMove = { r, c };
              }
            }
          }
        }

        makeMove(bestMove.r, bestMove.c, 'white');
        setIsAiThinking(false);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [currentPlayer, gameMode, winner, board, makeMove]);

  // Socket.io Setup
  useEffect(() => {
    if (gameMode === 'online') {
      socketRef.current = io();

      socketRef.current.on('player-assigned', (color: Player) => {
        setMyPlayerColor(color);
      });

      socketRef.current.on('game-start', () => {
        setIsGameStarted(true);
      });

      socketRef.current.on('move-made', ({ r, c, player }) => {
        makeMove(r, c, player, true);
      });

      socketRef.current.on('game-reset', () => {
        resetGame(true);
      });

      return () => {
        socketRef.current?.disconnect();
      };
    }
  }, [gameMode, makeMove]);

  const handleCellClick = (r: number, c: number) => {
    if (winner) return;
    if (gameMode === 'pvc' && currentPlayer === 'white') return;
    if (gameMode === 'online') {
      if (!isGameStarted || currentPlayer !== myPlayerColor) return;
    }
    makeMove(r, c, currentPlayer);
  };

  const resetGame = (isRemote = false) => {
    setBoard(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)));
    setCurrentPlayer('black');
    setWinner(null);
    setLastMove(null);
    setIsAiThinking(false);
    setHistory([]);

    if (!isRemote && gameMode === 'online' && socketRef.current && roomId) {
      socketRef.current.emit('reset-game', roomId);
    }
  };

  const undoMove = () => {
    if (history.length === 0 || isAiThinking || (gameMode === 'online')) return;

    let stepsToUndo = 1;
    if (gameMode === 'pvc') {
      // In PvC, undo 2 steps (AI's move and Player's move)
      // Unless AI hasn't moved yet or it's the very first move
      stepsToUndo = history.length >= 2 ? 2 : 1;
    }

    const newHistory = [...history];
    let targetState = null;
    
    for (let i = 0; i < stepsToUndo; i++) {
      targetState = newHistory.pop();
    }

    if (targetState) {
      setBoard(targetState.board);
      setCurrentPlayer(targetState.currentPlayer);
      setLastMove(targetState.lastMove);
      setWinner(targetState.winner);
      setHistory(newHistory);
    }
  };

  const joinRoom = () => {
    if (inputRoomId.trim() && socketRef.current) {
      setRoomId(inputRoomId.trim());
      socketRef.current.emit('join-room', inputRoomId.trim());
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.');

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col items-center justify-center p-4 font-sans text-[#1D1D1F]">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 text-center"
      >
        <h1 className="text-4xl font-bold tracking-tight mb-2">五子棋</h1>
        <div className="flex items-center justify-center gap-2 text-[#86868B] font-medium">
          <span>Minimalist Gomoku</span>
          <div className="w-1 h-1 rounded-full bg-[#D2D2D7]" />
          <span className="text-[#0071E3]">
            {gameMode === 'pvc' ? '人机对战' : gameMode === 'pvp' ? '双人对战' : '联机对战'}
          </span>
        </div>
      </motion.div>

      {/* Mode Selector */}
      <div className="mb-6 p-1 bg-[#E5E5E7] rounded-full flex gap-1">
        <button
          onClick={() => { setGameMode('pvc'); resetGame(); }}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
            gameMode === 'pvc' ? 'bg-white shadow-sm text-[#1D1D1F]' : 'text-[#86868B] hover:text-[#1D1D1F]'
          }`}
        >
          <Cpu className="w-4 h-4" />
          人机模式
        </button>
        <button
          onClick={() => { setGameMode('pvp'); resetGame(); }}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
            gameMode === 'pvp' ? 'bg-white shadow-sm text-[#1D1D1F]' : 'text-[#86868B] hover:text-[#1D1D1F]'
          }`}
        >
          <User className="w-4 h-4" />
          双人模式
        </button>
        <button
          onClick={() => { setGameMode('online'); resetGame(); setRoomId(''); setInputRoomId(''); setIsGameStarted(false); setMyPlayerColor(null); }}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
            gameMode === 'online' ? 'bg-white shadow-sm text-[#1D1D1F]' : 'text-[#86868B] hover:text-[#1D1D1F]'
          }`}
        >
          <Globe className="w-4 h-4" />
          联机模式
        </button>
      </div>

      {/* Online Setup UI */}
      {gameMode === 'online' && !roomId && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-8 bg-white p-8 rounded-3xl shadow-xl border border-[#D2D2D7]/30 flex flex-col items-center gap-6 w-full max-w-md"
        >
          <div className="w-16 h-16 bg-[#F5F5F7] rounded-2xl flex items-center justify-center">
            <Globe className="w-8 h-8 text-[#0071E3]" />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold mb-1">加入游戏房间</h2>
            <p className="text-[#86868B] text-sm">输入房间号与好友对战</p>
          </div>
          <div className="w-full flex gap-2">
            <div className="relative flex-1">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B]" />
              <input
                type="text"
                value={inputRoomId}
                onChange={(e) => setInputRoomId(e.target.value)}
                placeholder="房间号 (如: 1234)"
                className="w-full pl-10 pr-4 py-3 bg-[#F5F5F7] border border-[#D2D2D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0071E3]/20 focus:border-[#0071E3] transition-all"
              />
            </div>
            <button
              onClick={joinRoom}
              className="bg-[#0071E3] text-white px-6 py-3 rounded-xl font-semibold hover:bg-[#0077ED] transition-all active:scale-95"
            >
              加入
            </button>
          </div>
        </motion.div>
      )}

      {/* Online Room Info */}
      {gameMode === 'online' && roomId && (
        <div className="mb-6 flex flex-col items-center gap-4 w-full max-w-md">
          <div className="flex items-center justify-between w-full bg-white px-6 py-3 rounded-2xl shadow-sm border border-white/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#F5F5F7] rounded-lg flex items-center justify-center">
                <Hash className="w-4 h-4 text-[#86868B]" />
              </div>
              <div>
                <p className="text-[10px] text-[#86868B] font-bold uppercase tracking-wider">房间号</p>
                <p className="font-mono font-bold text-[#1D1D1F]">{roomId}</p>
              </div>
            </div>
            <button
              onClick={copyRoomId}
              className="p-2 hover:bg-[#F5F5F7] rounded-lg transition-colors text-[#0071E3]"
            >
              {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
          
          {!isGameStarted && (
            <motion.div 
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="text-sm font-medium text-[#86868B]"
            >
              等待对手加入...
            </motion.div>
          )}

          {isGameStarted && (
            <div className="text-sm font-medium text-[#0071E3] flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#0071E3] animate-pulse" />
              你执 {myPlayerColor === 'black' ? '黑子' : '白子'}
            </div>
          )}

          {/* Connection Guide Card */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full bg-[#F5F5F7] p-4 rounded-2xl border border-[#D2D2D7]/50"
          >
            <p className="text-[10px] text-[#86868B] font-bold uppercase tracking-wider mb-2">连接指南</p>
            <div className="space-y-2 text-xs text-[#1D1D1F]">
              <div className="flex items-start gap-2">
                <div className="w-4 h-4 rounded-full bg-[#0071E3]/10 text-[#0071E3] flex items-center justify-center text-[10px] font-bold mt-0.5">1</div>
                <p>让好友访问：<span className="font-mono bg-white px-1 py-0.5 rounded border border-[#D2D2D7]">{window.location.origin}</span></p>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-4 h-4 rounded-full bg-[#0071E3]/10 text-[#0071E3] flex items-center justify-center text-[10px] font-bold mt-0.5">2</div>
                <p>进入联机模式并输入相同的房间号：<span className="font-mono font-bold">{roomId}</span></p>
              </div>
              <div className="mt-3 pt-3 border-t border-[#D2D2D7]/30 flex items-center gap-2 text-[#86868B]">
                {isLocalhost ? (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <span>检测到局域网环境：确保双方在同一个 WiFi 下</span>
                  </>
                ) : (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#0071E3]" />
                    <span>检测到公网环境：支持跨地域全球对战</span>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Game Info */}
      {(gameMode !== 'online' || roomId) && (
        <div className="mb-6 flex items-center gap-8 bg-white/80 backdrop-blur-md px-6 py-3 rounded-2xl shadow-sm border border-white/20">
          <div className={`flex items-center gap-2 transition-opacity duration-300 ${currentPlayer === 'black' ? 'opacity-100' : 'opacity-40'}`}>
            <div className="w-4 h-4 rounded-full bg-[#1D1D1F]" />
            <span className="text-sm font-semibold uppercase tracking-wider">Black</span>
          </div>
          
          <div className="h-4 w-[1px] bg-[#D2D2D7]" />

          <div className={`flex items-center gap-2 transition-opacity duration-300 ${currentPlayer === 'white' ? 'opacity-100' : 'opacity-40'}`}>
            <div className="w-4 h-4 rounded-full bg-white border border-[#D2D2D7]" />
            <span className="text-sm font-semibold uppercase tracking-wider">
              {gameMode === 'pvc' ? 'AI (White)' : 'White'}
            </span>
            {isAiThinking && (
              <motion.div
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="text-[10px] text-[#0071E3] font-bold ml-1"
              >
                THINKING...
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* Board Container */}
      {(gameMode !== 'online' || roomId) && (
        <div className="relative p-3 bg-[#E5E5E7] rounded-2xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)]">
          <div 
            className="grid gap-0 bg-[#D2D2D7] border-[2px] border-[#D2D2D7]"
            style={{ 
              gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
              width: 'min(92vw, calc(100vh - 380px), 640px)',
              aspectRatio: '1/1'
            }}
          >
            {board.map((row, r) => (
              row.map((cell, c) => (
                <button
                  key={`${r}-${c}`}
                  onClick={() => handleCellClick(r, c)}
                  disabled={!!winner || (gameMode === 'pvc' && currentPlayer === 'white') || (gameMode === 'online' && (!isGameStarted || currentPlayer !== myPlayerColor))}
                  className={`relative aspect-square transition-colors group flex items-center justify-center disabled:cursor-default ${
                    (r + c) % 2 === 0 ? 'bg-[#F5F5F7]' : 'bg-[#EFEFF1]'
                  } hover:bg-[#E2E2E7]`}
                  style={{
                    borderRight: c < BOARD_SIZE - 1 ? '1px solid #D2D2D7' : 'none',
                    borderBottom: r < BOARD_SIZE - 1 ? '1px solid #D2D2D7' : 'none',
                  }}
                >
                  {/* Grid intersection lines (visual only) */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-full h-[1px] bg-[#D2D2D7]/50" />
                    <div className="h-full w-[1px] bg-[#D2D2D7]/50 absolute" />
                  </div>

                  {/* Piece */}
                  <AnimatePresence mode="popLayout">
                    {cell && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 0.85, opacity: 1 }}
                        className={`w-full h-full rounded-full shadow-md z-10 ${
                          cell === 'black' ? 'bg-[#1D1D1F]' : 'bg-white border border-[#D2D2D7]'
                        } flex items-center justify-center`}
                      >
                        {lastMove?.r === r && lastMove?.c === c && (
                          <div className={`w-1.5 h-1.5 rounded-full ${cell === 'black' ? 'bg-white/30' : 'bg-black/10'}`} />
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Hover Preview */}
                  {!cell && !winner && !(gameMode === 'pvc' && currentPlayer === 'white') && !(gameMode === 'online' && (!isGameStarted || currentPlayer !== myPlayerColor)) && (
                    <div className={`absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-20 transition-opacity`}>
                      <div className={`w-[85%] h-[85%] rounded-full ${currentPlayer === 'black' ? 'bg-black' : 'bg-white border border-black'}`} />
                    </div>
                  )}
                </button>
              ))
            ))}
          </div>

          {/* Winner Overlay */}
          <AnimatePresence>
            {winner && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute inset-0 z-20 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl"
              >
                <div className="bg-white p-8 rounded-3xl shadow-2xl border border-[#D2D2D7]/30 flex flex-col items-center text-center max-w-[80%]">
                  <div className="w-16 h-16 bg-[#F5F5F7] rounded-2xl flex items-center justify-center mb-4">
                    <Trophy className="w-8 h-8 text-[#FFD700]" />
                  </div>
                  <h2 className="text-2xl font-bold mb-1">
                    {winner === 'draw' ? '平局' : `${winner === 'black' ? '黑棋' : '白棋'} 获胜!`}
                  </h2>
                  <p className="text-[#86868B] mb-6">
                    {gameMode === 'pvc' && winner === 'white' ? '电脑太强大了，再接再厉' : '恭喜，这是一场精彩的对决'}
                  </p>
                  <button
                    onClick={() => resetGame()}
                    className="flex items-center gap-2 bg-[#0071E3] hover:bg-[#0077ED] text-white px-6 py-3 rounded-full font-semibold transition-all active:scale-95 shadow-lg shadow-blue-500/20"
                  >
                    <RotateCcw className="w-4 h-4" />
                    再来一局
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Controls */}
      {(gameMode !== 'online' || roomId) && (
        <div className="mt-8 flex gap-4">
          <button
            onClick={() => undoMove()}
            disabled={history.length === 0 || isAiThinking || !!winner}
            className="flex items-center gap-2 bg-white hover:bg-[#F5F5F7] border border-[#D2D2D7] px-6 py-2.5 rounded-full font-medium transition-all active:scale-95 text-[#1D1D1F] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Undo2 className="w-4 h-4" />
            悔棋
          </button>
          <button
            onClick={() => resetGame()}
            className="flex items-center gap-2 bg-white hover:bg-[#F5F5F7] border border-[#D2D2D7] px-6 py-2.5 rounded-full font-medium transition-all active:scale-95 text-[#1D1D1F]"
          >
            <RotateCcw className="w-4 h-4" />
            重置游戏
          </button>
          {gameMode === 'online' && (
            <button
              onClick={() => { setRoomId(''); setInputRoomId(''); setIsGameStarted(false); setMyPlayerColor(null); }}
              className="flex items-center gap-2 bg-white hover:bg-[#F5F5F7] border border-[#D2D2D7] px-6 py-2.5 rounded-full font-medium transition-all active:scale-95 text-[#86868B]"
            >
              <ArrowLeft className="w-4 h-4" />
              退出房间
            </button>
          )}
        </div>
      )}

      {/* Footer Info */}
      <div className="mt-12 text-[#86868B] text-xs flex items-center gap-4 uppercase tracking-[0.1em]">
        <div className="flex items-center gap-1.5">
          {gameMode === 'pvc' ? <Cpu className="w-3 h-3" /> : gameMode === 'pvp' ? <User className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
          <span>{gameMode === 'pvc' ? 'VS Computer' : gameMode === 'pvp' ? 'Local Multiplayer' : 'Online Multiplayer'}</span>
        </div>
        <div className="w-1 h-1 rounded-full bg-[#D2D2D7]" />
        <div className="flex items-center gap-1.5">
          <Circle className="w-3 h-3" />
          <span>15x15 Grid</span>
        </div>
      </div>
    </div>
  );
}
