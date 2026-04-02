/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, Trophy, User, Circle, Cpu, Globe, Hash, Copy, Check, ArrowLeft, Undo2, Sparkles, BarChart3, Camera, Calendar } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { GoogleGenAI, Type } from "@google/genai";
import html2canvas from 'html2canvas';

const BOARD_SIZE = 15;

type Player = 'black' | 'white';
type CellValue = Player | null;
type GameMode = 'pvp' | 'pvc' | 'online';
type AiType = 'local' | 'gemini';

export default function App() {
  const [board, setBoard] = useState<CellValue[][]>(
    Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null))
  );
  const [currentPlayer, setCurrentPlayer] = useState<Player>('black');
  const [winner, setWinner] = useState<Player | 'draw' | null>(null);
  const [winningLine, setWinningLine] = useState<{ r: number; c: number }[] | null>(null);
  const [lastMove, setLastMove] = useState<{ r: number; c: number } | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>('pvc');
  const [aiType, setAiType] = useState<AiType>('local');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [aiComment, setAiComment] = useState<string | null>(null);
  const [history, setHistory] = useState<{ board: CellValue[][], currentPlayer: Player, lastMove: { r: number; c: number } | null, winner: Player | 'draw' | null }[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const MAX_UNDO = 3;

  // Online Mode States
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [myPlayerColor, setMyPlayerColor] = useState<Player | null>(null);
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Stats State
  const [stats, setStats] = useState({
    humanWins: 0,
    aiWins: 0,
    draws: 0
  });
  const [lastVictoryImage, setLastVictoryImage] = useState<string | null>(null);
  const [lastVictoryTime, setLastVictoryTime] = useState<string | null>(null);

  // Load Stats
  useEffect(() => {
    const savedStats = localStorage.getItem('gomoku_stats');
    if (savedStats) {
      try {
        setStats(JSON.parse(savedStats));
      } catch (e) {
        console.error("Failed to parse stats", e);
      }
    }
  }, []);

  // Save Stats
  useEffect(() => {
    localStorage.setItem('gomoku_stats', JSON.stringify(stats));
  }, [stats]);

  const captureVictory = async () => {
    if (boardRef.current) {
      try {
        const canvas = await html2canvas(boardRef.current, {
          backgroundColor: '#F5F5F7',
          scale: 2,
        });
        const image = canvas.toDataURL('image/png');
        setLastVictoryImage(image);
        setLastVictoryTime(new Date().toLocaleString('zh-CN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }));
      } catch (error) {
        console.error("Failed to capture screenshot", error);
      }
    }
  };

  const checkWinner = useCallback((board: CellValue[][], row: number, col: number, player: Player) => {
    const directions = [
      [0, 1],  // horizontal
      [1, 0],  // vertical
      [1, 1],  // diagonal \
      [1, -1], // diagonal /
    ];

    for (const [dr, dc] of directions) {
      let line = [{ r: row, c: col }];
      
      // Check forward
      for (let i = 1; i < 5; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
          line.push({ r, c });
        } else break;
      }
      
      // Check backward
      for (let i = 1; i < 5; i++) {
        const r = row - dr * i;
        const c = col - dc * i;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
          line.push({ r, c });
        } else break;
      }
      
      if (line.length >= 5) return line;
    }
    return null;
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

      const winLine = checkWinner(newBoard, r, c, player);
      if (winLine) {
        setWinner(player);
        setWinningLine(winLine);
        if (gameMode === 'pvc') {
          if (player === 'black') {
            setStats(s => ({ ...s, humanWins: s.humanWins + 1 }));
            setTimeout(captureVictory, 600);
          } else {
            setStats(s => ({ ...s, aiWins: s.aiWins + 1 }));
          }
        }
      } else if (newBoard.every(row => row.every(cell => cell !== null))) {
        setWinner('draw');
        if (gameMode === 'pvc') {
          setStats(s => ({ ...s, draws: s.draws + 1 }));
        }
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

  // AI Turn Logic (Gemini or Local Heuristic)
  useEffect(() => {
    if (gameMode === 'pvc' && currentPlayer === 'white' && !winner) {
      const getAiMove = async () => {
        setIsAiThinking(true);
        setAiComment(null);
        
        if (aiType === 'gemini') {
          try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const response = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: `You are a Gomoku (Five in a Row) grandmaster. You are playing as White (AI).
              The board is 15x15. Black (Human) moves first.
              Current board state (null is empty, 'black' is human, 'white' is you):
              ${JSON.stringify(board)}
              
              Analyze the board carefully. Prioritize blocking the opponent's 4-in-a-row or 3-in-a-row.
              Try to create your own 5-in-a-row.
              Return your next move as a JSON object with 'row', 'col' (0-14), and a short 'comment' in Chinese about your strategy.`,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    row: { type: Type.INTEGER },
                    col: { type: Type.INTEGER },
                    comment: { type: Type.STRING }
                  },
                  required: ["row", "col"]
                }
              }
            });

            const result = JSON.parse(response.text || "{}");
            if (typeof result.row === 'number' && typeof result.col === 'number' && !board[result.row][result.col]) {
              if (result.comment) setAiComment(result.comment);
              makeMove(result.row, result.col, 'white');
              setIsAiThinking(false);
              return;
            }
          } catch (error) {
            console.error("Gemini AI error, falling back to local heuristic:", error);
          }
        }

        // Fallback or Local Heuristic
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
      };

      const timer = setTimeout(getAiMove, 600);
      return () => clearTimeout(timer);
    }
  }, [currentPlayer, gameMode, aiType, winner, board, makeMove]);

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
    setWinningLine(null);
    setLastMove(null);
    setIsAiThinking(false);
    setHistory([]);
    setAiComment(null);
    setLastVictoryImage(null);
    setLastVictoryTime(null);
    setUndoCount(0);

    if (!isRemote && gameMode === 'online' && socketRef.current && roomId) {
      socketRef.current.emit('reset-game', roomId);
    }
  };

  const undoMove = () => {
    if (history.length === 0 || isAiThinking || (gameMode === 'online')) return;
    if (gameMode === 'pvc' && undoCount >= MAX_UNDO) return;

    let stepsToUndo = 1;
    if (gameMode === 'pvc') {
      // In PvC, undo 2 steps (AI's move and Player's move)
      // Unless AI hasn't moved yet or it's the very first move
      stepsToUndo = history.length >= 2 ? 2 : 1;
      setUndoCount(prev => prev + 1);
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
      setWinningLine(null);
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
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col items-center justify-center p-2 sm:p-4 font-sans text-[#1D1D1F]">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4 sm:mb-8 text-center"
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

      {/* Stats Display */}
      {gameMode === 'pvc' && (
        <div className="mb-6 flex gap-4">
          <div className="bg-white px-4 py-2 rounded-2xl shadow-sm border border-[#D2D2D7]/30 flex items-center gap-3">
            <div className="w-8 h-8 bg-[#EFF6FF] rounded-lg flex items-center justify-center">
              <User className="w-4 h-4 text-[#0071E3]" />
            </div>
            <div>
              <div className="text-[10px] text-[#86868B] font-bold uppercase tracking-wider">玩家胜</div>
              <div className="text-sm font-bold">{stats.humanWins}</div>
            </div>
          </div>
          <div className="bg-white px-4 py-2 rounded-2xl shadow-sm border border-[#D2D2D7]/30 flex items-center gap-3">
            <div className="w-8 h-8 bg-[#FAF5FF] rounded-lg flex items-center justify-center">
              <Cpu className="w-4 h-4 text-[#9333EA]" />
            </div>
            <div>
              <div className="text-[10px] text-[#86868B] font-bold uppercase tracking-wider">AI 胜</div>
              <div className="text-sm font-bold">{stats.aiWins}</div>
            </div>
          </div>
          <div className="bg-white px-4 py-2 rounded-2xl shadow-sm border border-[#D2D2D7]/30 flex items-center gap-3">
            <div className="w-8 h-8 bg-[#F9FAFB] rounded-lg flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-[#6B7280]" />
            </div>
            <div>
              <div className="text-[10px] text-[#86868B] font-bold uppercase tracking-wider">平局</div>
              <div className="text-sm font-bold">{stats.draws}</div>
            </div>
          </div>
        </div>
      )}

      {/* Mode Selector */}
      <div className="mb-4 sm:mb-6 p-1 bg-[#E5E5E7] rounded-full flex gap-1">
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

      {/* AI Type Selector (Sub-menu for PVC) */}
      <AnimatePresence>
        {gameMode === 'pvc' && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 flex items-center gap-4 bg-white/40 backdrop-blur-sm px-4 py-2 rounded-2xl border border-white/20"
          >
            <span className="text-xs font-bold text-[#86868B] uppercase tracking-widest">AI 引擎</span>
            <div className="flex gap-2">
              <button
                onClick={() => { setAiType('local'); resetGame(); }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  aiType === 'local' ? 'bg-[#1D1D1F] text-white' : 'text-[#86868B] hover:bg-[#1D1D1F]/5'
                }`}
              >
                本地算法
              </button>
              <button
                onClick={() => { setAiType('gemini'); resetGame(); }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  aiType === 'gemini' ? 'bg-[#0071E3] text-white' : 'text-[#86868B] hover:bg-[#0071E3]/5'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                Gemini AI
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
                    <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
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
        <div className="mb-4 sm:mb-6 flex items-center gap-8 bg-white/80 backdrop-blur-md px-6 py-3 rounded-2xl shadow-sm border border-white/20">
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
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex flex-col items-start ml-2"
              >
                <div className="flex items-center gap-1.5">
                  <motion.div
                    animate={{ 
                      scale: [1, 1.2, 1],
                      opacity: [0.7, 1, 0.7]
                    }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    <Sparkles className="w-3 h-3 text-[#0071E3]" />
                  </motion.div>
                  <motion.span 
                    animate={{ 
                      opacity: [0.6, 1, 0.6],
                    }}
                    transition={{ 
                      repeat: Infinity, 
                      duration: 1.5,
                      ease: "easeInOut"
                    }}
                    className="text-[10px] text-[#0071E3] font-bold tracking-widest"
                  >
                    {aiType === 'gemini' ? 'GEMINI THINKING' : 'AI THINKING'}
                  </motion.span>
                </div>
                
                {/* Enhanced Progress Bar */}
                <div className="w-28 h-1 bg-[#D2D2D7]/30 rounded-full mt-1.5 overflow-hidden relative">
                  <motion.div
                    initial={{ x: "-100%" }}
                    animate={{ x: "200%" }}
                    transition={{ 
                      repeat: Infinity, 
                      duration: 1.5, 
                      ease: "linear" 
                    }}
                    className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-[#0071E3] to-transparent"
                  />
                </div>

                {aiComment && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[9px] text-[#86868B] italic max-w-[140px] truncate mt-1 bg-white/50 px-1.5 py-0.5 rounded-md border border-[#D2D2D7]/20"
                  >
                    "{aiComment}"
                  </motion.div>
                )}
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* Board Container */}
      {(gameMode !== 'online' || roomId) && (
        <div className="relative p-3 bg-[#C7C7CC] rounded-2xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)]">
          <div 
            ref={boardRef}
            className="grid gap-0 bg-[#AEAEB2] border-[2px] border-[#AEAEB2]"
            style={{ 
              gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
              width: 'min(98vw, calc(100vh - 160px), 900px)',
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
                    (r + c) % 2 === 0 ? 'bg-[#D1D1D6]' : 'bg-[#C7C7CC]'
                  } hover:bg-[#BDBDC2] ${lastMove?.r === r && lastMove?.c === c ? 'z-20' : 'z-0'}`}
                  style={{
                    borderRight: c < BOARD_SIZE - 1 ? '1px solid #AEAEB2' : 'none',
                    borderBottom: r < BOARD_SIZE - 1 ? '1px solid #AEAEB2' : 'none',
                  }}
                >
                  {/* Grid intersection lines (visual only) */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-full h-[1px] bg-[#AEAEB2]/40" />
                    <div className="h-full w-[1px] bg-[#AEAEB2]/40 absolute" />
                  </div>

                  {/* Piece */}
                  <AnimatePresence>
                    {cell && (
                      <motion.div
                        key={`cell-${r}-${c}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        {/* Ripple Effect on Placement */}
                        {lastMove?.r === r && lastMove?.c === c && (
                          <motion.div
                            initial={{ scale: 0.5, opacity: 1 }}
                            animate={{ scale: 3, opacity: 0 }}
                            transition={{ duration: 0.8, ease: "easeOut" }}
                            className={`absolute inset-0 z-0 pointer-events-none ${cell === 'black' ? 'bg-black/20' : 'bg-white/40'}`}
                          />
                        )}
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={
                            winningLine?.some(pos => pos.r === r && pos.c === c)
                              ? { 
                                  scale: [0.85, 0.95, 0.85],
                                  boxShadow: cell === 'black' 
                                    ? ["0 0 0px rgba(0,0,0,0)", "0 0 15px rgba(0,0,0,0.5)", "0 0 0px rgba(0,0,0,0)"]
                                    : ["0 0 0px rgba(255,255,255,0)", "0 0 15px rgba(255,255,255,0.8)", "0 0 0px rgba(255,255,255,0)"]
                                }
                              : { scale: 0.85, opacity: 1 }
                          }
                          transition={
                            winningLine?.some(pos => pos.r === r && pos.c === c)
                              ? { repeat: Infinity, duration: 1.5 }
                              : { duration: 0.2 }
                          }
                          className={`w-full h-full rounded-full shadow-md z-10 ${
                            cell === 'black' ? 'bg-[#1D1D1F]' : 'bg-white border border-[#AEAEB2]'
                          } flex items-center justify-center relative`}
                        >
                          {lastMove?.r === r && lastMove?.c === c && (
                            <div className={`w-1.5 h-1.5 rounded-full ${cell === 'black' ? 'bg-white/30' : 'bg-black/10'}`} />
                          )}
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Hover Preview */}
                  {!cell && !winner && !(gameMode === 'pvc' && currentPlayer === 'white') && !(gameMode === 'online' && (!isGameStarted || currentPlayer !== myPlayerColor)) && (
                    <div className={`absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-40 group-hover:scale-110 transition-all duration-200`}>
                      <div className={`w-[85%] h-[85%] rounded-full shadow-inner ${currentPlayer === 'black' ? 'bg-black' : 'bg-white border border-black'}`} />
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
                  
                  {lastVictoryImage && winner === 'black' && gameMode === 'pvc' && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-6 p-2 bg-[#F5F5F7] rounded-2xl border border-[#D2D2D7]/50"
                    >
                      <div className="relative group">
                        <img src={lastVictoryImage} alt="Victory" className="w-48 h-48 object-cover rounded-xl shadow-inner" />
                        <div className="absolute bottom-2 left-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[10px] py-1 px-2 rounded-lg flex items-center gap-1.5">
                          <Calendar className="w-3 h-3" />
                          {lastVictoryTime}
                        </div>
                        <div className="absolute top-2 right-2 bg-[#0071E3] text-white p-1.5 rounded-full shadow-lg">
                          <Camera className="w-3 h-3" />
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-[#86868B] font-bold uppercase tracking-wider">胜利瞬间已保存</div>
                    </motion.div>
                  )}

                  <button
                    onClick={() => resetGame()}
                    className="flex items-center gap-2 bg-[#0071E3] hover:bg-[#0077ED] text-white px-6 py-3 rounded-full font-semibold transition-all active:scale-95 shadow-lg shadow-[#3B82F6]/20"
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
        <div className="mt-4 sm:mt-8 flex flex-col items-center gap-4">
          {gameMode === 'pvc' && (
            <div className="text-[10px] text-[#86868B] font-bold uppercase tracking-widest flex items-center gap-2">
              <span>悔棋次数: {undoCount} / {MAX_UNDO}</span>
              {undoCount >= MAX_UNDO && <span className="text-[#EF4444]">(已用完)</span>}
            </div>
          )}
          <div className="flex gap-4">
            <button
              onClick={() => undoMove()}
              disabled={history.length === 0 || isAiThinking || !!winner || (gameMode === 'pvc' && undoCount >= MAX_UNDO)}
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
