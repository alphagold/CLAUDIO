import { useQuery } from '@tanstack/react-query';
import { Loader, Clock, Wand2 } from 'lucide-react';
import apiClient from '../api/client';
import type { QueueStatus } from '../types';

export function AnalysisQueueWidget() {
  const { data: queueStatus, isLoading, error } = useQuery<QueueStatus>({
    queryKey: ['queueStatus'],
    queryFn: async () => {
      const response = await apiClient.get('/api/photos/queue-status');
      return response.data;
    },
    refetchInterval: 5000,
    staleTime: 0,
    retry: 1,
  });

  if (error) {
    return (
      <div className="bg-red-100 border border-red-300 text-red-800 rounded-lg p-4 mb-6">
        <p className="font-semibold">Errore caricamento stato coda</p>
        <p className="text-sm">{error instanceof Error ? error.message : 'Errore sconosciuto'}</p>
      </div>
    );
  }

  if (isLoading || !queueStatus) {
    return null;
  }

  const hasAnalysis = queueStatus.total_in_progress > 0 || queueStatus.queue_size > 0;
  const hasRewrite = (queueStatus.rewrite_pending || 0) > 0;

  if (!hasAnalysis && !hasRewrite) {
    return null;
  }

  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const total = queueStatus.total_in_progress + queueStatus.queue_size;
  const progressPercent = total > 0
    ? (queueStatus.total_in_progress / total) * 100
    : 0;

  return (
    <div className="space-y-3 mb-6">
      {/* Analysis queue */}
      {hasAnalysis && (
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg shadow-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-white/20 p-2 rounded-lg">
                <Loader className="w-5 h-5 animate-spin" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Analisi in Corso</h3>
                {queueStatus.current_photo && (
                  <p className="text-sm text-white/90">
                    Elaborando: {queueStatus.current_photo.filename}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-6">
              {queueStatus.current_photo && (
                <div className="flex items-center space-x-2 bg-white/20 px-3 py-2 rounded-lg">
                  <Clock className="w-4 h-4" />
                  <span className="font-mono text-sm">
                    {formatElapsedTime(queueStatus.current_photo.elapsed_seconds)}
                  </span>
                </div>
              )}

              {queueStatus.queue_size > 0 && (
                <div className="flex items-center space-x-2 bg-white/20 px-3 py-2 rounded-lg">
                  <div className="flex flex-col items-center">
                    <span className="text-xs opacity-80">In Coda</span>
                    <span className="text-xl font-bold">{queueStatus.queue_size}</span>
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-2 bg-white/20 px-3 py-2 rounded-lg">
                <div className="flex flex-col items-center">
                  <span className="text-xs opacity-80">Totale</span>
                  <span className="text-xl font-bold">{total}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          {queueStatus.queue_size > 0 && (
            <div className="mt-3">
              <div className="bg-white/20 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-white h-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rewrite queue */}
      {hasRewrite && (
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-lg shadow-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-white/20 p-2 rounded-lg">
                <Wand2 className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Traduzione EN → IT</h3>
                <p className="text-sm text-white/90">
                  Riscrittura descrizioni in italiano in corso
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 bg-white/20 px-3 py-2 rounded-lg">
              <div className="flex flex-col items-center">
                <span className="text-xs opacity-80">Attive</span>
                <span className="text-xl font-bold">{queueStatus.rewrite_pending}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
