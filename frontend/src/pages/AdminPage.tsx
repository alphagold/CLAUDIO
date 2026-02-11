import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import {
  Server,
  Activity,
  FileText,
  RefreshCw,
  CheckCircle,
  XCircle,
  HardDrive,
  Image as ImageIcon,
  Eye,
  Loader,
  Users,
  ChevronRight,
  Cpu,
  MemoryStick,
  MessageSquare,
  UserCheck,
  Play,
} from 'lucide-react';
import apiClient from '../api/client';
import toast from 'react-hot-toast';

interface SystemStatus {
  containers: Array<{ name: string; status: string }>;
  statistics: {
    total_photos: number;
    analyzed_photos: number;
    pending_analysis: number;
    disk_usage_mb: number;
  };
  face_detection: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    no_faces: number;
    skipped: number;
    total_faces: number;
    persons: number;
  };
  system: {
    cpu_percent: number;
    memory_percent: number;
    memory_used_mb: number;
    memory_total_mb: number;
  };
}

interface LogResponse {
  logs: string;
  lines: number;
}

export default function AdminPage() {
  const navigate = useNavigate();
  const [logType, setLogType] = useState<'backend' | 'ollama'>('backend');
  const [logLines, setLogLines] = useState(100);

  const requeueFacesMutation = useMutation({
    mutationFn: (resetFailed: boolean) =>
      apiClient.post(`/api/admin/faces/requeue?reset_failed=${resetFailed}`),
    onSuccess: (data) => {
      toast.success(data.data.message);
      refetchStatus();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'Errore nel riaccodamento face detection');
    },
  });

  // Fetch system status
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<SystemStatus>({
    queryKey: ['admin', 'status'],
    queryFn: async () => {
      const response = await apiClient.get('/api/admin/status');
      return response.data;
    },
  });

  // Fetch logs
  const { data: logs, isLoading: logsLoading, refetch: refetchLogs } = useQuery<LogResponse>({
    queryKey: ['admin', 'logs', logType, logLines],
    queryFn: async () => {
      const response = await apiClient.get(`/api/admin/logs/${logType}?lines=${logLines}`);
      return response.data;
    },
  });

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'exited':
      case 'dead':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'paused':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
        return <CheckCircle className="w-5 h-5" />;
      case 'exited':
      case 'dead':
        return <XCircle className="w-5 h-5" />;
      default:
        return <Loader className="w-5 h-5 animate-spin" />;
    }
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
            <p className="text-gray-600 mt-1">System monitoring and logs</p>
          </div>
          <button
            onClick={() => {
              refetchStatus();
              refetchLogs();
            }}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
            <span>Refresh</span>
          </button>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Total Photos */}
          <div className="group relative bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl shadow-sm hover:shadow-lg border border-blue-200/50 p-6 overflow-hidden transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-blue-900 text-sm font-semibold">Total Photos</span>
                <div className="p-2 bg-blue-600/10 rounded-lg">
                  <ImageIcon className="w-5 h-5 text-blue-600" />
                </div>
              </div>
              <p className="text-4xl font-bold text-blue-900">
                {statusLoading ? '...' : status?.statistics.total_photos || 0}
              </p>
            </div>
          </div>

          {/* Analyzed Photos */}
          <div className="group relative bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl shadow-sm hover:shadow-lg border border-green-200/50 p-6 overflow-hidden transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-green-600/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-green-900 text-sm font-semibold">Analyzed</span>
                <div className="p-2 bg-green-600/10 rounded-lg">
                  <Eye className="w-5 h-5 text-green-600" />
                </div>
              </div>
              <p className="text-4xl font-bold text-green-900">
                {statusLoading ? '...' : status?.statistics.analyzed_photos || 0}
              </p>
              {status && status.statistics.total_photos > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-green-700 mb-1">
                    <span>Progress</span>
                    <span className="font-semibold">{Math.round((status.statistics.analyzed_photos / status.statistics.total_photos) * 100)}%</span>
                  </div>
                  <div className="w-full bg-green-200 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-green-600 to-emerald-500 h-2 rounded-full transition-all duration-1000"
                      style={{ width: `${(status.statistics.analyzed_photos / status.statistics.total_photos) * 100}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Pending Analysis */}
          <div className="group relative bg-gradient-to-br from-yellow-50 to-amber-100 rounded-xl shadow-sm hover:shadow-lg border border-yellow-200/50 p-6 overflow-hidden transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-600/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-yellow-900 text-sm font-semibold">Pending</span>
                <div className="p-2 bg-yellow-600/10 rounded-lg">
                  <Activity className="w-5 h-5 text-yellow-600 animate-pulse" />
                </div>
              </div>
              <p className="text-4xl font-bold text-yellow-900">
                {statusLoading ? '...' : status?.statistics.pending_analysis || 0}
              </p>
            </div>
          </div>

          {/* Disk Usage */}
          <div className="group relative bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl shadow-sm hover:shadow-lg border border-purple-200/50 p-6 overflow-hidden transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-600/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-purple-900 text-sm font-semibold">Disk Usage</span>
                <div className="p-2 bg-purple-600/10 rounded-lg">
                  <HardDrive className="w-5 h-5 text-purple-600" />
                </div>
              </div>
              <p className="text-4xl font-bold text-purple-900">
                {statusLoading ? '...' : Math.round(status?.statistics.disk_usage_mb || 0)}
              </p>
              <p className="text-xs text-purple-700 mt-1 font-medium">MB</p>
            </div>
          </div>

          {/* CPU Usage */}
          <div className="group relative bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl shadow-sm hover:shadow-lg border border-orange-200/50 p-6 overflow-hidden transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-600/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-orange-900 text-sm font-semibold">CPU Usage</span>
                <div className="p-2 bg-orange-600/10 rounded-lg">
                  <Cpu className="w-5 h-5 text-orange-600" />
                </div>
              </div>
              <p className="text-4xl font-bold text-orange-900">
                {statusLoading ? '...' : status?.system.cpu_percent || 0}
                <span className="text-2xl">%</span>
              </p>
              <div className="w-full bg-orange-200 rounded-full h-2 mt-3">
                <div
                  className="bg-gradient-to-r from-orange-600 to-orange-500 h-2 rounded-full transition-all duration-1000"
                  style={{ width: `${status?.system.cpu_percent || 0}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* RAM Usage */}
          <div className="group relative bg-gradient-to-br from-pink-50 to-pink-100 rounded-xl shadow-sm hover:shadow-lg border border-pink-200/50 p-6 overflow-hidden transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-pink-600/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-pink-900 text-sm font-semibold">RAM Usage</span>
                <div className="p-2 bg-pink-600/10 rounded-lg">
                  <MemoryStick className="w-5 h-5 text-pink-600" />
                </div>
              </div>
              <p className="text-4xl font-bold text-pink-900">
                {statusLoading ? '...' : status?.system.memory_percent || 0}
                <span className="text-2xl">%</span>
              </p>
              <p className="text-xs text-pink-700 mt-2 font-medium">
                {status && `${Math.round(status.system.memory_used_mb)} / ${Math.round(status.system.memory_total_mb)} MB`}
              </p>
              <div className="w-full bg-pink-200 rounded-full h-2 mt-2">
                <div
                  className="bg-gradient-to-r from-pink-600 to-pink-500 h-2 rounded-full transition-all duration-1000"
                  style={{ width: `${status?.system.memory_percent || 0}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>

        {/* Face Detection Queue */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <UserCheck className="w-5 h-5 text-blue-600" />
              <h2 className="text-xl font-semibold text-gray-900">Coda Riconoscimento Volti</h2>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => requeueFacesMutation.mutate(false)}
                disabled={requeueFacesMutation.isPending}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
                title="Ri-accoda foto pending e bloccate in processing"
              >
                <Play className={`w-4 h-4 ${requeueFacesMutation.isPending ? 'animate-spin' : ''}`} />
                <span>Ri-accoda Pending</span>
              </button>
              <button
                onClick={() => requeueFacesMutation.mutate(true)}
                disabled={requeueFacesMutation.isPending}
                className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700 disabled:opacity-50 transition-colors text-sm"
                title="Ri-accoda anche foto failed e no_faces"
              >
                <RefreshCw className={`w-4 h-4 ${requeueFacesMutation.isPending ? 'animate-spin' : ''}`} />
                <span>Ri-accoda Tutto</span>
              </button>
            </div>
          </div>

          {statusLoading ? (
            <div className="flex items-center justify-center h-16">
              <Loader className="w-6 h-6 text-blue-600 animate-spin" />
            </div>
          ) : status?.face_detection ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              {[
                { label: 'Completati', value: status.face_detection.completed, color: 'text-green-700 bg-green-50 border-green-200' },
                { label: 'Nessun volto', value: status.face_detection.no_faces, color: 'text-gray-600 bg-gray-50 border-gray-200' },
                { label: 'In attesa', value: status.face_detection.pending, color: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
                { label: 'In corso', value: status.face_detection.processing, color: 'text-blue-700 bg-blue-50 border-blue-200' },
                { label: 'Falliti', value: status.face_detection.failed, color: 'text-red-700 bg-red-50 border-red-200' },
                { label: 'Saltati', value: status.face_detection.skipped, color: 'text-gray-500 bg-gray-50 border-gray-200' },
                { label: 'Volti totali', value: status.face_detection.total_faces, color: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
                { label: 'Persone', value: status.face_detection.persons, color: 'text-purple-700 bg-purple-50 border-purple-200' },
              ].map((item) => (
                <div key={item.label} className={`rounded-lg border p-3 text-center ${item.color}`}>
                  <div className="text-2xl font-bold">{item.value ?? '—'}</div>
                  <div className="text-xs mt-1 font-medium">{item.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Face recognition non disponibile su questo server</p>
          )}
        </div>

        {/* Quick Links Section - Gestione Sistema */}
        <div className="mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Gestione Sistema</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <button
                onClick={() => navigate('/admin/users')}
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Users className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-gray-900">Gestione Utenti</p>
                    <p className="text-sm text-gray-600">Crea e gestisci gli utenti</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>

              <button
                onClick={() => navigate('/admin/monitoring')}
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Activity className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-gray-900">Monitoring Sistema</p>
                    <p className="text-sm text-gray-600">CPU, RAM e grafici in tempo reale</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>

              <button
                onClick={() => navigate('/admin/models')}
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <Server className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-gray-900">Modelli Ollama</p>
                    <p className="text-sm text-gray-600">Scarica e gestisci modelli AI</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>

              <button
                onClick={() => navigate('/admin/prompts')}
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-orange-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-gray-900">Configurazione Prompt</p>
                    <p className="text-sm text-gray-600">Personalizza prompt AI</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>
        </div>

        {/* Containers Status */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex items-center space-x-2 mb-4">
            <Server className="w-5 h-5 text-gray-600" />
            <h2 className="text-xl font-semibold text-gray-900">Containers Status</h2>
          </div>

          {statusLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {status?.containers.map((container) => (
                <div
                  key={container.name}
                  className={`flex items-center justify-between p-4 rounded-lg border ${getStatusColor(container.status)}`}
                >
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(container.status)}
                    <div>
                      <p className="font-medium text-sm">
                        {container.name.replace('photomemory-', '')}
                      </p>
                      <p className="text-xs capitalize">{container.status}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Logs Viewer */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <FileText className="w-5 h-5 text-gray-600" />
              <h2 className="text-xl font-semibold text-gray-900">System Logs</h2>
            </div>

            <div className="flex items-center space-x-4">
              {/* Log Type Selector */}
              <div className="flex space-x-2">
                <button
                  onClick={() => setLogType('backend')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    logType === 'backend'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Backend
                </button>
                <button
                  onClick={() => setLogType('ollama')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    logType === 'ollama'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Ollama
                </button>
              </div>

              {/* Lines Selector */}
              <select
                value={logLines}
                onChange={(e) => setLogLines(Number(e.target.value))}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value={50}>50 lines</option>
                <option value={100}>100 lines</option>
                <option value={200}>200 lines</option>
                <option value={500}>500 lines</option>
              </select>

              {/* Refresh Logs Button */}
              <button
                onClick={() => refetchLogs()}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                title="Aggiorna logs"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Log Content */}
          {logsLoading ? (
            <div className="flex items-center justify-center h-96">
              <Loader className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : (
            <div className="bg-gray-900 rounded-lg p-4 h-96 overflow-auto">
              <div className="text-xs font-mono whitespace-pre-wrap break-words">
                {(logs?.logs || 'No logs available').split('\n').map((line, idx) => {
                  const isError = /error|exception|failed|fatal/i.test(line);
                  const isWarning = /warn|warning/i.test(line);

                  return (
                    <div
                      key={idx}
                      className={
                        isError ? 'text-red-400 bg-red-900/20' :
                        isWarning ? 'text-yellow-400 bg-yellow-900/20' :
                        'text-green-400'
                      }
                    >
                      {line}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
