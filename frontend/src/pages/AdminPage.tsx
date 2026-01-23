import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  MemoryStick
} from 'lucide-react';
import apiClient from '../api/client';

interface SystemStatus {
  containers: Array<{ name: string; status: string }>;
  statistics: {
    total_photos: number;
    analyzed_photos: number;
    pending_analysis: number;
    disk_usage_mb: number;
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Total Photos</span>
              <ImageIcon className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {statusLoading ? '...' : status?.statistics.total_photos || 0}
            </p>
          </div>

          {/* Analyzed Photos */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Analyzed</span>
              <Eye className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {statusLoading ? '...' : status?.statistics.analyzed_photos || 0}
            </p>
            {status && status.statistics.total_photos > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {Math.round((status.statistics.analyzed_photos / status.statistics.total_photos) * 100)}%
              </p>
            )}
          </div>

          {/* Pending Analysis */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Pending</span>
              <Activity className="w-5 h-5 text-yellow-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {statusLoading ? '...' : status?.statistics.pending_analysis || 0}
            </p>
          </div>

          {/* Disk Usage */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Disk Usage</span>
              <HardDrive className="w-5 h-5 text-purple-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {statusLoading ? '...' : Math.round(status?.statistics.disk_usage_mb || 0)}
            </p>
            <p className="text-xs text-gray-500 mt-1">MB</p>
          </div>

          {/* CPU Usage */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">CPU Usage</span>
              <Cpu className="w-5 h-5 text-orange-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {statusLoading ? '...' : status?.system.cpu_percent || 0}
            </p>
            <p className="text-xs text-gray-500 mt-1">%</p>
          </div>

          {/* RAM Usage */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">RAM Usage</span>
              <MemoryStick className="w-5 h-5 text-pink-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {statusLoading ? '...' : status?.system.memory_percent || 0}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {status && `${Math.round(status.system.memory_used_mb)} / ${Math.round(status.system.memory_total_mb)} MB`}
            </p>
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
              <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap break-words">
                {logs?.logs || 'No logs available'}
              </pre>
            </div>
          )}
        </div>

        {/* Quick Links Section */}
        <div className="mt-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Gestione Sistema</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
