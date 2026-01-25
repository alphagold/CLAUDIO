import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/Layout';
import apiClient from '../api/client';
import { Settings, Sparkles, Zap, Save, Loader } from 'lucide-react';
import toast from 'react-hot-toast';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  preferred_model: string;
  auto_analyze: boolean;
  created_at: string;
}

const MODELS = [
  {
    id: 'moondream',
    name: 'Moondream',
    description: 'Ultraleggero e velocissimo',
    size: '1.7 GB',
    speed: '~10 secondi',
    icon: Zap,
    color: 'green'
  },
  {
    id: 'llava-phi3',
    name: 'LLaVA-Phi3',
    description: 'Bilanciato tra velocità e qualità',
    size: '3.8 GB',
    speed: '~30 secondi',
    icon: Sparkles,
    color: 'blue'
  },
  {
    id: 'llama3.2-vision',
    name: 'Llama 3.2 Vision',
    description: 'Massima qualità e dettaglio',
    size: '7.9 GB',
    speed: '~10 minuti',
    icon: Sparkles,
    color: 'purple'
  },
  {
    id: 'qwen3-vl:latest',
    name: 'Qwen3-VL',
    description: 'Modello avanzato multilingua',
    size: '~4 GB',
    speed: '~1 minuto',
    icon: Sparkles,
    color: 'indigo'
  },
  {
    id: 'llava:latest',
    name: 'LLaVA',
    description: 'Modello versatile e preciso',
    size: '~4.5 GB',
    speed: '~45 secondi',
    icon: Sparkles,
    color: 'cyan'
  }
];

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['user', 'profile'],
    queryFn: async () => {
      const response = await apiClient.get('/api/user/profile');
      return response.data;
    },
  });

  const [preferredModel, setPreferredModel] = useState(profile?.preferred_model || 'moondream');
  const [autoAnalyze, setAutoAnalyze] = useState(profile?.auto_analyze ?? true);

  // Sync local state with profile data when it loads or changes
  useEffect(() => {
    if (profile) {
      setPreferredModel(profile.preferred_model || 'moondream');
      setAutoAnalyze(profile.auto_analyze ?? true);
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async (data: { preferred_model?: string; auto_analyze?: boolean }) => {
      const params = new URLSearchParams();
      if (data.preferred_model) params.append('preferred_model', data.preferred_model);
      if (data.auto_analyze !== undefined) params.append('auto_analyze', String(data.auto_analyze));

      const response = await apiClient.patch(`/api/user/preferences?${params.toString()}`);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Impostazioni salvate con successo!');
      queryClient.invalidateQueries({ queryKey: ['user', 'profile'] });
    },
    onError: () => {
      toast.error('Errore nel salvataggio delle impostazioni');
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      preferred_model: preferredModel,
      auto_analyze: autoAnalyze,
    });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <Loader className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center space-x-3 mb-2">
            <Settings className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Impostazioni</h1>
          </div>
          <p className="text-gray-600">Personalizza le tue preferenze per l'analisi AI delle foto</p>
        </div>

        {/* Auto-analyze toggle */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Analisi Automatica</h2>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-gray-700 font-medium mb-1">Analizza automaticamente le nuove foto</p>
              <p className="text-sm text-gray-500">
                Quando attivo, le foto vengono analizzate automaticamente dopo il caricamento.
                Quando disattivo, puoi analizzarle manualmente dalla galleria.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer ml-6">
              <input
                type="checkbox"
                checked={autoAnalyze}
                onChange={(e) => setAutoAnalyze(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>

        {/* Model selection */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Modello AI Preferito</h2>
          <p className="text-sm text-gray-600 mb-6">
            Scegli il modello da utilizzare per l'analisi delle foto. Puoi sempre scegliere un modello diverso durante la rianalisi.
          </p>

          <div className="space-y-3">
            {MODELS.map((model) => {
              const Icon = model.icon;
              const isSelected = preferredModel === model.id;
              const colorClasses = {
                green: 'border-green-300 bg-green-50',
                blue: 'border-blue-300 bg-blue-50',
                purple: 'border-purple-300 bg-purple-50'
              };
              const selectedColor = {
                green: 'border-green-500 bg-green-100',
                blue: 'border-blue-500 bg-blue-100',
                purple: 'border-purple-500 bg-purple-100'
              };

              return (
                <button
                  key={model.id}
                  onClick={() => setPreferredModel(model.id)}
                  className={`w-full p-4 border-2 rounded-xl text-left transition-all hover:shadow-md ${
                    isSelected ? selectedColor[model.color as keyof typeof selectedColor] : colorClasses[model.color as keyof typeof colorClasses]
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <Icon className={`w-5 h-5 text-${model.color}-600`} />
                        <span className="font-semibold text-gray-900">{model.name}</span>
                        {isSelected && (
                          <span className="text-xs bg-green-500 text-white px-2 py-1 rounded-full">Selezionato</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{model.description}</p>
                      <div className="flex items-center space-x-4 text-xs text-gray-500">
                        <span>📦 {model.size}</span>
                        <span>⚡ {model.speed}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
          >
            {updateMutation.isPending ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                <span>Salvataggio...</span>
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                <span>Salva Impostazioni</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Layout>
  );
}
