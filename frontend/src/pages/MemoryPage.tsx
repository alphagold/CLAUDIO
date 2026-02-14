import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, RefreshCw, ThumbsUp, ThumbsDown, Plus, Trash2, Loader, Bot, StopCircle } from 'lucide-react';
import Layout from '../components/Layout';
import { memoryApi } from '../api/client';
import type { MemoryAnswer, MemoryDirective } from '../types';
import toast from 'react-hot-toast';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  conversationId?: string;
  model?: string;
  contextItems?: number;
  feedback?: 'positive' | 'negative' | null;
}

export default function MemoryPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [directives, setDirectives] = useState<MemoryDirective[]>([]);
  const [loadingDirectives, setLoadingDirectives] = useState(true);
  const [newDirective, setNewDirective] = useState('');
  const [creatingDirective, setCreatingDirective] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchDirectives();
    fetchHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchHistory = async () => {
    try {
      setLoadingHistory(true);
      const data = await memoryApi.getConversations(100);
      const historyMessages: ChatMessage[] = [];
      for (const c of data.conversations) {
        historyMessages.push({ role: 'user', content: c.question });
        historyMessages.push({
          role: 'assistant',
          content: c.answer,
          conversationId: c.id,
          model: c.context?.model || undefined,
          contextItems: c.context?.items_found,
          feedback: c.feedback as 'positive' | 'negative' | null,
        });
      }
      setMessages(historyMessages);
    } catch {
      // Cronologia non disponibile, inizia con chat vuota
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchDirectives = async () => {
    try {
      setLoadingDirectives(true);
      const data = await memoryApi.getDirectives(false);
      setDirectives(data.directives);
    } catch {
      toast.error('Errore nel caricamento direttive');
    } finally {
      setLoadingDirectives(false);
    }
  };

  const handleAsk = async () => {
    const question = input.trim();
    if (!question || asking) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setAsking(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result: MemoryAnswer = await memoryApi.ask(question, undefined, controller.signal);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.answer,
        conversationId: result.conversation_id,
        model: result.model,
        contextItems: result.context_items,
        feedback: null,
      }]);
    } catch (error: any) {
      if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Risposta interrotta.',
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Errore nella comunicazione con il server. Riprova.',
        }]);
      }
    } finally {
      setAsking(false);
      abortControllerRef.current = null;
    }
  };

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Cancellare tutta la cronologia della chat?')) return;
    try {
      await memoryApi.clearConversations();
      setMessages([]);
      toast.success('Cronologia cancellata');
    } catch {
      toast.error('Errore nella cancellazione');
    }
  };

  const handleFeedback = async (msgIndex: number, feedback: 'positive' | 'negative') => {
    const msg = messages[msgIndex];
    if (!msg.conversationId || msg.feedback === feedback) return;

    try {
      await memoryApi.learn(msg.conversationId, feedback);
      setMessages(prev => prev.map((m, i) =>
        i === msgIndex ? { ...m, feedback } : m
      ));
    } catch {
      toast.error('Errore nel salvataggio feedback');
    }
  };

  const handleReindex = async () => {
    if (reindexing) return;
    setReindexing(true);
    try {
      const result = await memoryApi.reindex();
      toast.success(`Reindicizzazione completata: ${result.total} elementi indicizzati`);
    } catch {
      toast.error('Errore durante la reindicizzazione');
    } finally {
      setReindexing(false);
    }
  };

  const handleCreateDirective = async () => {
    const text = newDirective.trim();
    if (!text || creatingDirective) return;

    setCreatingDirective(true);
    try {
      await memoryApi.createDirective(text);
      setNewDirective('');
      fetchDirectives();
      toast.success('Direttiva creata');
    } catch {
      toast.error('Errore nella creazione direttiva');
    } finally {
      setCreatingDirective(false);
    }
  };

  const handleToggleDirective = async (d: MemoryDirective) => {
    try {
      await memoryApi.updateDirective(d.id, { is_active: !d.is_active });
      fetchDirectives();
    } catch {
      toast.error('Errore nell\'aggiornamento direttiva');
    }
  };

  const handleDeleteDirective = async (id: string) => {
    try {
      await memoryApi.deleteDirective(id);
      fetchDirectives();
      toast.success('Direttiva eliminata');
    } catch {
      toast.error('Errore nell\'eliminazione direttiva');
    }
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl shadow-lg">
              <MessageCircle className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Memoria</h1>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Cancella cronologia
              </button>
            )}
            <button
              onClick={handleReindex}
              disabled={reindexing}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${reindexing ? 'animate-spin' : ''}`} />
              {reindexing ? 'Reindicizzazione...' : 'Reindicizza'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chat area - 2/3 */}
          <div className="lg:col-span-2 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 180px)' }}>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingHistory ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Loader className="w-8 h-8 animate-spin mb-4" />
                  <p className="text-sm">Caricamento cronologia...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Bot className="w-16 h-16 mb-4 opacity-50" />
                  <p className="text-lg font-medium">Chiedi qualcosa sulle tue foto</p>
                  <p className="text-sm mt-1">Es: "Dove sono andato in vacanza?" o "Quante foto ho con Marco?"</p>
                </div>
              ) : null}

              {!loadingHistory && messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>

                    {msg.role === 'assistant' && msg.conversationId && (
                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                        {msg.model && <span>{msg.model}</span>}
                        {msg.contextItems !== undefined && (
                          <span>{msg.contextItems} contesti</span>
                        )}
                        <div className="flex items-center gap-1 ml-auto">
                          <button
                            onClick={() => handleFeedback(i, 'positive')}
                            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
                              msg.feedback === 'positive' ? 'text-green-600' : 'text-gray-400'
                            }`}
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleFeedback(i, 'negative')}
                            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
                              msg.feedback === 'negative' ? 'text-red-600' : 'text-gray-400'
                            }`}
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {asking && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3">
                    <Loader className="w-5 h-5 animate-spin text-gray-500" />
                    <button
                      onClick={handleAbort}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                      Interrompi
                    </button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-200 p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAsk()}
                  placeholder="Fai una domanda sulle tue foto..."
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={asking}
                />
                <button
                  onClick={handleAsk}
                  disabled={asking || !input.trim()}
                  className="px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Directives panel - 1/3 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 180px)' }}>
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Direttive personali</h2>
              <p className="text-xs text-gray-500 mt-1">Istruzioni che l'AI seguira' nelle risposte</p>
            </div>

            {/* New directive input */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDirective}
                  onChange={(e) => setNewDirective(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateDirective()}
                  placeholder="Nuova direttiva..."
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  disabled={creatingDirective}
                />
                <button
                  onClick={handleCreateDirective}
                  disabled={creatingDirective || !newDirective.trim()}
                  className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Directives list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ maxHeight: 'calc(100vh - 360px)' }}>
              {loadingDirectives ? (
                <div className="flex justify-center py-8">
                  <Loader className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : directives.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">
                  Nessuna direttiva. Aggiungine una per personalizzare le risposte.
                </p>
              ) : (
                directives.map((d) => (
                  <div
                    key={d.id}
                    className={`p-3 rounded-lg border text-sm transition-colors ${
                      d.is_active
                        ? 'bg-purple-50 border-purple-200'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <p className={`${d.is_active ? 'text-gray-900' : 'text-gray-500 line-through'}`}>
                      {d.directive}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => handleToggleDirective(d)}
                        className={`text-xs px-2 py-1 rounded ${
                          d.is_active
                            ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        } transition-colors`}
                      >
                        {d.is_active ? 'Attiva' : 'Disattiva'}
                      </button>
                      <button
                        onClick={() => handleDeleteDirective(d.id)}
                        className="text-xs p-1 text-red-400 hover:text-red-600 transition-colors ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
