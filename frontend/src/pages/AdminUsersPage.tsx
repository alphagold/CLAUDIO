import Layout from '../components/Layout';
import UserManagement from '../components/UserManagement';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AdminUsersPage() {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate('/admin')}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">Torna all'Admin Panel</span>
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Gestione Utenti</h1>
          <p className="text-gray-600 mt-1">Crea, modifica ed elimina gli utenti del sistema</p>
        </div>

        {/* User Management Component */}
        <UserManagement />
      </div>
    </Layout>
  );
}
