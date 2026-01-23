import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Cpu, MemoryStick, Activity, RefreshCw } from 'lucide-react';
import apiClient from '../api/client';

interface MetricEntry {
  timestamp: string;
  cpu_percent: number;
  memory_percent: number;
}

interface MetricsHistory {
  metrics: MetricEntry[];
  count: number;
}

export default function SystemMetricsMonitor() {
  const [isRecording, setIsRecording] = useState(false);

  // Fetch metrics history
  const { data: historyData, refetch } = useQuery<MetricsHistory>({
    queryKey: ['admin', 'metrics', 'history'],
    queryFn: async () => {
      const response = await apiClient.get('/api/admin/metrics/history');
      return response.data;
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const metrics = historyData?.metrics || [];

  // Start recording metrics when component mounts
  useEffect(() => {
    const recordMetric = async () => {
      try {
        await apiClient.post('/api/admin/metrics/record');
        refetch();
      } catch (error) {
        console.error('Failed to record metrics:', error);
      }
    };

    // Record immediately
    recordMetric();
    setIsRecording(true);

    // Then record every 5 seconds
    const interval = setInterval(recordMetric, 5000);

    return () => {
      clearInterval(interval);
      setIsRecording(false);
    };
  }, [refetch]);

  // Format data for chart
  const chartData = metrics.map((entry) => ({
    time: new Date(entry.timestamp).toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    CPU: entry.cpu_percent,
    RAM: entry.memory_percent,
  }));

  // Get current values (latest entry)
  const currentCpu = metrics.length > 0 ? metrics[metrics.length - 1].cpu_percent : 0;
  const currentRam = metrics.length > 0 ? metrics[metrics.length - 1].memory_percent : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <Activity className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-900">Monitoring Risorse Sistema</h2>
        </div>
        <div className="flex items-center space-x-2">
          {isRecording && (
            <div className="flex items-center space-x-2 text-sm">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-gray-600">Live (aggiornamento ogni 5s)</span>
            </div>
          )}
          <button
            onClick={() => refetch()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Aggiorna"
          >
            <RefreshCw className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Current Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-900">CPU Usage</span>
            <Cpu className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-3xl font-bold text-blue-900">{currentCpu}%</p>
          <div className="w-full bg-blue-200 rounded-full h-2 mt-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${currentCpu}%` }}
            ></div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg p-4 border border-pink-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-pink-900">RAM Usage</span>
            <MemoryStick className="w-5 h-5 text-pink-600" />
          </div>
          <p className="text-3xl font-bold text-pink-900">{currentRam}%</p>
          <div className="w-full bg-pink-200 rounded-full h-2 mt-2">
            <div
              className="bg-pink-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${currentRam}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Historical Chart */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Storico (ultimi 5 minuti)</h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="time"
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Line
                type="monotone"
                dataKey="CPU"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="CPU %"
              />
              <Line
                type="monotone"
                dataKey="RAM"
                stroke="#ec4899"
                strokeWidth={2}
                dot={false}
                name="RAM %"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-500">
            <p>Raccogliendo dati...</p>
          </div>
        )}
      </div>

      {/* Stats Summary */}
      <div className="mt-4 grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-xs text-gray-500">Punti dati</p>
          <p className="text-lg font-semibold text-gray-900">{metrics.length}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">CPU Media</p>
          <p className="text-lg font-semibold text-gray-900">
            {metrics.length > 0
              ? Math.round(metrics.reduce((sum, m) => sum + m.cpu_percent, 0) / metrics.length)
              : 0}
            %
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">RAM Media</p>
          <p className="text-lg font-semibold text-gray-900">
            {metrics.length > 0
              ? Math.round(metrics.reduce((sum, m) => sum + m.memory_percent, 0) / metrics.length)
              : 0}
            %
          </p>
        </div>
      </div>
    </div>
  );
}
