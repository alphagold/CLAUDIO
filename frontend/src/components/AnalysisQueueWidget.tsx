import { useQuery } from '@tanstack/react-query';
import { Loader, Clock } from 'lucide-react';
import apiClient from '../api/client';
import type { QueueStatus } from '../types';

export function AnalysisQueueWidget() {
  // Poll queue status every 1s
  const { data: queueStatus, isLoading, error, isError } = useQuery<QueueStatus>({
    queryKey: ['queueStatus'],
    queryFn: async () => {
      console.log('[AnalysisQueueWidget] Fetching queue status...');
      try {
        const response = await apiClient.get('/api/photos/queue-status');
        console.log('[AnalysisQueueWidget] Response received:', response.data);
        return response.data;
      } catch (err) {
        console.error('[AnalysisQueueWidget] Fetch error:', err);
        throw err;
      }
    },
    refetchInterval: 1000, // Poll every 1s
    staleTime: 0,
    retry: 3,
  });

  // Debug logging
  console.log('[AnalysisQueueWidget] Render - isLoading:', isLoading, 'isError:', isError, 'queueStatus:', queueStatus);

  if (error) {
    console.error('[AnalysisQueueWidget] Error fetching queue status:', error);
    // Show error state instead of hiding
    return (
      <div className="bg-red-100 border border-red-300 text-red-800 rounded-lg p-4 mb-6">
        <p className="font-semibold">Errore caricamento stato coda</p>
        <p className="text-sm">{error instanceof Error ? error.message : 'Errore sconosciuto'}</p>
      </div>
    );
  }

  if (isLoading || !queueStatus) {
    console.log('[AnalysisQueueWidget] Loading or no data, returning null');
    return null;
  }

  const hasActivity = queueStatus.total_in_progress > 0 || queueStatus.queue_size > 0;

  // Debug logging
  console.log('[AnalysisQueueWidget] Queue status:', queueStatus, 'hasActivity:', hasActivity);

  if (!hasActivity) {
    console.log('[AnalysisQueueWidget] No activity, hiding widget');
    return null;
  }

  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg shadow-lg p-4 mb-6">
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
              <span className="text-xl font-bold">
                {queueStatus.total_in_progress + queueStatus.queue_size}
              </span>
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
              style={{
                width: `${(queueStatus.total_in_progress / (queueStatus.total_in_progress + queueStatus.queue_size)) * 100}%`
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
