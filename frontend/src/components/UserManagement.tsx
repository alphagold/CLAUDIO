import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Users, UserPlus, Trash2, Shield, User as UserIcon, X } from 'lucide-react';
import apiClient from '../api/client';

interface User {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  role: 'admin' | 'editor' | 'viewer';
  created_at: string;
  photo_count: number;
}

const ROLES = {
  admin: { label: 'Admin', description: 'Accesso completo al sistema', color: 'purple' },
  editor: { label: 'Editor', description: 'Può gestire le proprie foto', color: 'blue' },
  viewer: { label: 'Viewer', description: 'Solo visualizzazione', color: 'gray' },
};

export default function UserManagement() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const response = await apiClient.get<User[]>('/api/admin/users');
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { email: string; password: string; full_name: string; role: string }) => {
      return apiClient.post('/api/admin/users', null, { params: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Utente creato con successo');
      setShowCreateModal(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Errore nella creazione utente');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/api/admin/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Utente eliminato');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Errore nell\'eliminazione');
    },
  });

  const handleDelete = (user: User) => {
    if (window.confirm(`Eliminare l'utente ${user.email}? Tutte le sue foto verranno eliminate.`)) {
      deleteMutation.mutate(user.id);
    }
  };

  const CreateUserModal = () => {
    const [formData, setFormData] = useState({
      email: '',
      password: '',
      full_name: '',
      role: 'editor' as 'admin' | 'editor' | 'viewer',
    });

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold">Nuovo Utente</h3>
            <button onClick={() => setShowCreateModal(false)}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate(formData);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Nome Completo</label>
              <input
                type="text"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Ruolo</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'editor' | 'viewer' })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {Object.entries(ROLES).map(([key, role]) => (
                  <option key={key} value={key}>
                    {role.label} - {role.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex space-x-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creazione...' : 'Crea'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-2">
          <Users className="w-6 h-6 text-purple-600" />
          <h2 className="text-2xl font-bold">Gestione Utenti</h2>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <UserPlus className="w-4 h-4" />
          <span>Nuovo Utente</span>
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-8">Caricamento...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Utente</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Email</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Ruolo</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Foto</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Creato</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users?.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <UserIcon className="w-4 h-4 text-blue-600" />
                      </div>
                      <span className="font-medium">{user.full_name || 'N/A'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const roleInfo = ROLES[user.role];
                      const colorClasses: Record<string, string> = {
                        purple: 'bg-purple-100 text-purple-700',
                        blue: 'bg-blue-100 text-blue-700',
                        gray: 'bg-gray-100 text-gray-700',
                      };
                      return (
                        <span className={`inline-flex items-center space-x-1 px-2 py-1 ${colorClasses[roleInfo.color]} rounded-full text-xs font-medium`}>
                          {user.role === 'admin' && <Shield className="w-3 h-3" />}
                          <span>{roleInfo.label}</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{user.photo_count}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(user.created_at).toLocaleDateString('it-IT')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => handleDelete(user)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        title="Elimina"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && <CreateUserModal />}
    </div>
  );
}
