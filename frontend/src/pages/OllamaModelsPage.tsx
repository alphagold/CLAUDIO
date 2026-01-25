import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/Layout';
import apiClient from '../api/client';
import { Download, Trash2, RefreshCw, Server, HardDrive, Package, Loader, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
}

interface OllamaStatus {
  status: 'online' | 'offline';
  host: string;
  models_count: number;
  total_size: number;
  total_size_gb: number;
}

export default function OllamaModelsPage() {
  const queryClient = useQueryClient();
  const [modelToPull, setModelToPull] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<{
    status: string;
    completed?: number;
    total?: number;
    percent?: number;
  } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const downloadStartTime = useRef<number | null>(null);

  // Fetch models list
  const { data: modelsData, isLoading: modelsLoading, refetch: refetchModels } = useQuery({
    queryKey: ['admin', 'ollama', 'models'],
    queryFn: async () => {
      const response = await apiClient.get('/api/admin/ollama/models');
      return response.data;
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch Ollama status
  const { data: statusData } = useQuery<OllamaStatus>({
    queryKey: ['admin', 'ollama', 'status'],
    queryFn: async () => {
      const response = await apiClient.get('/api/admin/ollama/status');
      return response.data;
    },
    refetchInterval: 5000,
  });

  // Track elapsed time during download
  useEffect(() => {
    let interval: number | null = null;

    if (isDownloading) {
      downloadStartTime.current = Date.now();
      setElapsedTime(0);

      interval = setInterval(() => {
        if (downloadStartTime.current) {
          setElapsedTime(Math.floor((Date.now() - downloadStartTime.current) / 1000));
        }
      }, 1000);
    } else {
      downloadStartTime.current = null;
      setElapsedTime(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isDownloading]);

  // Delete model mutation
  const deleteMutation = useMutation({
    mutationFn: (modelName: string) =>
      apiClient.delete(`/api/admin/ollama/models/${encodeURIComponent(modelName)}`),
    onSuccess: () => {
      toast.success('Modello eliminato con successo!');
      queryClient.invalidateQueries({ queryKey: ['admin', 'ollama'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Errore durante eliminazione');
    },
  });

  const handlePullModel = async () => {
    if (!modelToPull.trim()) {
      toast.error('Inserisci il nome del modello');
      return;
    }

    const modelName = modelToPull.trim();
    setIsDownloading(true);
    setDownloadProgress({ status: 'Connessione...' });

    try {
      const token = localStorage.getItem('auth_token');
      // EventSource doesn't support custom headers, so we pass token as query parameter
      const eventSource = new EventSource(
        `http://192.168.200.4:8000/api/admin/ollama/models/pull?model_name=${encodeURIComponent(modelName)}&token=${token}`
      );

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            toast.error(data.error);
            eventSource.close();
            setIsDownloading(false);
            setDownloadProgress(null);
            return;
          }

          // Update progress
          if (data.status) {
            const progress: any = { status: data.status };

            if (data.completed && data.total) {
              progress.completed = data.completed;
              progress.total = data.total;
              progress.percent = Math.round((data.completed / data.total) * 100);
            }

            setDownloadProgress(progress);

            // Download complete
            if (data.status === 'success') {
              toast.success(`Modello ${modelName} scaricato con successo!`);
              eventSource.close();
              setIsDownloading(false);
              setDownloadProgress(null);
              setModelToPull('');
              setTimeout(() => refetchModels(), 1000);
            }
          }
        } catch (e) {
          console.error('Error parsing SSE data:', e);
        }
      };

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        toast.error('Errore durante il download');
        eventSource.close();
        setIsDownloading(false);
        setDownloadProgress(null);
      };
    } catch (error) {
      toast.error('Errore durante il download');
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleDeleteModel = (modelName: string) => {
    if (window.confirm(`Sei sicuro di voler eliminare il modello "${modelName}"?`)) {
      deleteMutation.mutate(modelName);
    }
  };

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 ** 2);
    return `${mb.toFixed(0)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const models: OllamaModel[] = modelsData?.models || [];

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gestione Modelli Ollama</h1>
            <p className="text-gray-600 mt-1">Scarica, gestisci ed elimina modelli AI</p>
          </div>
          <button
            onClick={() => refetchModels()}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Aggiorna</span>
          </button>
        </div>

        {/* Status Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Server className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-semibold text-gray-900">Status Ollama</h2>
            </div>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${statusData?.status === 'online' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
              <span className={`font-medium ${statusData?.status === 'online' ? 'text-green-600' : 'text-red-600'}`}>
                {statusData?.status === 'online' ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <div className="flex items-center space-x-2 mb-2">
                <Package className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium text-blue-900">Modelli Installati</span>
              </div>
              <p className="text-3xl font-bold text-blue-900">{statusData?.models_count || 0}</p>
            </div>

            <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
              <div className="flex items-center space-x-2 mb-2">
                <HardDrive className="w-5 h-5 text-purple-600" />
                <span className="text-sm font-medium text-purple-900">Spazio Totale</span>
              </div>
              <p className="text-3xl font-bold text-purple-900">{statusData?.total_size_gb || 0} GB</p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="flex items-center space-x-2 mb-2">
                <Server className="w-5 h-5 text-gray-600" />
                <span className="text-sm font-medium text-gray-900">Host</span>
              </div>
              <p className="text-sm font-mono text-gray-700">{statusData?.host || 'N/A'}</p>
            </div>
          </div>
        </div>

        {/* Download New Model */}
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl shadow-sm border border-green-200 p-6 mb-6 animate-fade-in">
          <div className="flex items-center space-x-3 mb-4">
            <Download className="w-6 h-6 text-green-600" />
            <h2 className="text-xl font-semibold text-gray-900">Scarica Nuovo Modello</h2>
          </div>

          <div className="flex space-x-3">
            <input
              type="text"
              value={modelToPull}
              onChange={(e) => setModelToPull(e.target.value)}
              placeholder="Es: llama3.2-vision, moondream"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              onKeyDown={(e) => e.key === 'Enter' && handlePullModel()}
            />
            <button
              onClick={handlePullModel}
              disabled={isDownloading || !modelToPull.trim()}
              className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
            >
              {isDownloading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  <span>Download...</span>
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  <span>Scarica</span>
                </>
              )}
            </button>
          </div>

          {/* Download Progress */}
          {downloadProgress && (
            <div className="mt-4 bg-white rounded-lg p-4 border-2 border-green-300 shadow-sm animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <Loader className="w-5 h-5 text-green-600 animate-spin" />
                  <span className="text-sm font-semibold text-gray-900">{downloadProgress.status}</span>
                </div>
                <div className="flex items-center space-x-3">
                  {downloadProgress.percent !== undefined && (
                    <span className="text-lg font-bold text-green-600">{downloadProgress.percent}%</span>
                  )}
                  <span className="text-sm text-gray-500">
                    {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              {downloadProgress.percent !== undefined && (
                <div className="relative w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="absolute top-0 left-0 h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${downloadProgress.percent}%` }}
                  >
                    <div className="absolute top-0 right-0 bottom-0 left-0 bg-white opacity-20 animate-pulse"></div>
                  </div>
                </div>
              )}

              {/* Download Stats */}
              {downloadProgress.completed && downloadProgress.total && (
                <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
                  <span>{formatSize(downloadProgress.completed)} / {formatSize(downloadProgress.total)}</span>
                  <span>
                    {downloadProgress.total > 0 && elapsedTime > 0 && (
                      <>~{formatSize((downloadProgress.total - downloadProgress.completed) / (downloadProgress.completed / elapsedTime))} rimanenti</>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex items-start space-x-2 text-sm text-gray-600 bg-blue-50 p-3 rounded-lg border border-blue-200">
            <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-blue-900">Modelli consigliati:</p>
              <ul className="mt-1 space-y-1">
                <li><strong>moondream</strong> - Modello veloce per analisi rapide (~1.7 GB)</li>
                <li><strong>llava-phi3</strong> - Buon compromesso qualità/velocità (~3.8 GB)</li>
                <li><strong>qwen3-vl:latest</strong> - Modello avanzato multilingua (~4 GB)</li>
                <li><strong>llava:latest</strong> - Modello versatile e preciso (~4.5 GB)</li>
                <li><strong>llama3.2-vision</strong> - Massima qualità e dettaglio (~7.9 GB, richiede 10.9 GB RAM)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Models List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Modelli Scaricati</h2>

          {modelsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : models.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">Nessun modello installato</p>
              <p className="text-sm text-gray-500 mt-1">Scarica il tuo primo modello sopra</p>
            </div>
          ) : (
            <div className="space-y-3">
              {models.map((model) => (
                <div
                  key={model.name}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all"
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <Package className="w-5 h-5 text-blue-600" />
                      <h3 className="font-semibold text-gray-900">{model.name}</h3>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-mono">
                        {model.digest}
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-gray-600">
                      <div className="flex items-center space-x-1">
                        <HardDrive className="w-4 h-4" />
                        <span>{formatSize(model.size)}</span>
                      </div>
                      <div>
                        Modificato: {formatDate(model.modified_at)}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteModel(model.name)}
                    disabled={deleteMutation.isPending}
                    className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Elimina</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
