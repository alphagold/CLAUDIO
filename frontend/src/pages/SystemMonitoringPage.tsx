import Layout from '../components/Layout';
import SystemMetricsMonitor from '../components/SystemMetricsMonitor';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function SystemMonitoringPage() {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center space-x-4 mb-8">
          <button
            onClick={() => navigate('/admin')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Torna all'admin"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Monitoring Sistema</h1>
            <p className="text-gray-600 mt-1">Monitoraggio in tempo reale CPU e RAM</p>
          </div>
        </div>

        {/* Metrics Monitor Component */}
        <SystemMetricsMonitor />
      </div>
    </Layout>
  );
}
