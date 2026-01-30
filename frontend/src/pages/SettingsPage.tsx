import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import Layout from '../components/Layout';
import apiClient, { remoteOllamaApi, facesApi } from '../api/client';
import type { ConsentResponse } from '../types';
import { Settings, Sparkles, Zap, Save, Loader, Wifi, WifiOff, RefreshCw, User, Shield, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  preferred_model: string;
  auto_analyze: boolean;
  remote_ollama_enabled: boolean;
  remote_ollama_url: string;
  remote_ollama_model: string;
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
  const [remoteEnabled, setRemoteEnabled] = useState(profile?.remote_ollama_enabled ?? false);
  const [remoteUrl, setRemoteUrl] = useState(profile?.remote_ollama_url || 'http://localhost:11434');
  const [remoteModel, setRemoteModel] = useState(profile?.remote_ollama_model || 'moondream');

  // Stati per remote server
  const [testingConnection, setTestingConnection] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; size: number }>>([]);
  const [connectionTested, setConnectionTested] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  // Sync local state with profile data when it loads or changes
  useEffect(() => {
    if (profile) {
      setPreferredModel(profile.preferred_model || 'moondream');
      setAutoAnalyze(profile.auto_analyze ?? true);
      setRemoteEnabled(profile.remote_ollama_enabled ?? false);
      setRemoteUrl(profile.remote_ollama_url || 'http://localhost:11434');
      setRemoteModel(profile.remote_ollama_model || 'moondream');
    }
  }, [profile]);

  // Face Recognition Consent (optional - may not be available)
  const { data: consentData, error: consentError } = useQuery<ConsentResponse>({
    queryKey: ['faces', 'consent'],
    queryFn: () => facesApi.getConsent(),
    retry: false,
  });

  const giveConsentMutation = useMutation({
    mutationFn: () => facesApi.giveConsent(),
    onSuccess: () => {
      toast.success('Consenso concesso con successo!');
      queryClient.invalidateQueries({ queryKey: ['faces', 'consent'] });
    },
    onError: () => {
      toast.error('Errore nella concessione del consenso');
    },
  });

  const revokeConsentMutation = useMutation({
    mutationFn: (deleteData: boolean) => facesApi.revokeConsent(deleteData),
    onSuccess: () => {
      toast.success('Consenso revocato');
      queryClient.invalidateQueries({ queryKey: ['faces', 'consent'] });
    },
    onError: () => {
      toast.error('Errore nella revoca del consenso');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: {
      preferred_model?: string;
      auto_analyze?: boolean;
      remote_ollama_enabled?: boolean;
      remote_ollama_url?: string;
      remote_ollama_model?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.preferred_model) params.append('preferred_model', data.preferred_model);
      if (data.auto_analyze !== undefined) params.append('auto_analyze', String(data.auto_analyze));
      if (data.remote_ollama_enabled !== undefined) params.append('remote_ollama_enabled', String(data.remote_ollama_enabled));
      if (data.remote_ollama_url) params.append('remote_ollama_url', data.remote_ollama_url);
      if (data.remote_ollama_model) params.append('remote_ollama_model', data.remote_ollama_model);

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

  const handleTestConnection = async () => {
    if (!remoteUrl.trim()) {
      toast.error('Inserisci un URL valido');
      return;
    }

    setTestingConnection(true);
    setConnectionTested(false);
    setAvailableModels([]);

    try {
      // Test connessione
      const testResult = await remoteOllamaApi.testConnection(remoteUrl);

      if (testResult.status === 'ok') {
        toast.success('Connessione riuscita!');
        setConnectionTested(true);

        // Fetch modelli disponibili
        setLoadingModels(true);
        try {
          const modelsData = await remoteOllamaApi.fetchModels(remoteUrl);
          setAvailableModels(modelsData.models);

          if (modelsData.models.length === 0) {
            toast.error('Nessun modello disponibile sul server remoto');
          } else {
            toast.success(`Trovati ${modelsData.models.length} modelli disponibili`);
            // Auto-select first model if current selection not in list
            const currentModelExists = modelsData.models.some((m) => m.name === remoteModel);
            if (!currentModelExists && modelsData.models.length > 0) {
              setRemoteModel(modelsData.models[0].name);
            }
          }
        } catch (err) {
          console.error('Error fetching models:', err);
          toast.error('Errore nel recupero dei modelli');
        } finally {
          setLoadingModels(false);
        }
      } else {
        toast.error(testResult.message || 'Connessione fallita');
        setConnectionTested(false);
      }
    } catch (error: any) {
      console.error('Test connection error:', error);
      const errorMsg = error.response?.data?.detail || error.message || 'Errore di connessione';
      toast.error(errorMsg);
      setConnectionTested(false);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSave = () => {
    updateMutation.mutate({
      preferred_model: preferredModel,
      auto_analyze: autoAnalyze,
      remote_ollama_enabled: remoteEnabled,
      remote_ollama_url: remoteUrl,
      remote_ollama_model: remoteModel,
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

        {/* Remote Ollama Server Configuration */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center space-x-3 mb-6">
            <Sparkles className="w-6 h-6 text-purple-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Server Ollama Remoto</h2>
              <p className="text-sm text-gray-600">Usa il tuo PC locale per analisi velocissime</p>
            </div>
          </div>

          {/* Enable Remote Server Toggle */}
          <div className="mb-6">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={remoteEnabled}
                onChange={(e) => setRemoteEnabled(e.target.checked)}
                className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
              />
              <span className="text-gray-900 font-medium">Abilita Server Remoto</span>
            </label>
            <p className="text-sm text-gray-600 mt-2 ml-8">
              Quando abilitato, puoi selezionare "Server Remoto" durante l'analisi foto
            </p>
          </div>

          {remoteEnabled && (
            <>
              {/* Remote URL */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  URL Server (IP:Porta)
                </label>
                <input
                  type="text"
                  value={remoteUrl}
                  onChange={(e) => {
                    setRemoteUrl(e.target.value);
                    setConnectionTested(false); // Reset test status on URL change
                    setAvailableModels([]);
                  }}
                  placeholder="http://192.168.1.100:11434"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Esempio: http://192.168.1.100:11434
                </p>
              </div>

              {/* Test Connection Button */}
              <div className="mb-4">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testingConnection || !remoteUrl.trim()}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {testingConnection ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin" />
                      <span>Test connessione in corso...</span>
                    </>
                  ) : connectionTested ? (
                    <>
                      <Wifi className="w-5 h-5" />
                      <span>Connessione OK - Riprova</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-5 h-5" />
                      <span>Test Connessione</span>
                    </>
                  )}
                </button>

                {connectionTested && (
                  <p className="text-xs text-green-600 mt-2 flex items-center space-x-1">
                    <Wifi className="w-4 h-4" />
                    <span>Server raggiungibile - {availableModels.length} modelli disponibili</span>
                  </p>
                )}
              </div>

              {/* Remote Model Selection - Dynamic or Fallback */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Modello sul Server Remoto
                </label>

                {loadingModels ? (
                  <div className="flex items-center justify-center py-4 text-gray-500">
                    <Loader className="w-5 h-5 animate-spin mr-2" />
                    <span>Caricamento modelli...</span>
                  </div>
                ) : availableModels.length > 0 ? (
                  <>
                    <select
                      value={remoteModel}
                      onChange={(e) => setRemoteModel(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      {availableModels.map((model) => (
                        <option key={model.name} value={model.name}>
                          {model.name} ({(model.size / 1024 / 1024 / 1024).toFixed(1)} GB)
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Seleziona il modello installato sul server remoto
                    </p>
                  </>
                ) : (
                  <>
                    <select
                      value={remoteModel}
                      onChange={(e) => setRemoteModel(e.target.value)}
                      disabled={!connectionTested}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {MODELS.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} ({model.size})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-yellow-600 mt-1 flex items-center space-x-1">
                      <RefreshCw className="w-3 h-3" />
                      <span>Testa la connessione per vedere i modelli realmente disponibili</span>
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Face Recognition Consent */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center space-x-3 mb-6">
            <User className="w-6 h-6 text-indigo-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Riconoscimento Facciale</h2>
              <p className="text-sm text-gray-600">Identifica automaticamente le persone nelle tue foto</p>
            </div>
          </div>

          {consentError && axios.isAxiosError(consentError) && consentError.response?.status === 404 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-900 mb-1">Feature Non Disponibile</p>
                  <p className="text-sm text-yellow-700">
                    Il riconoscimento facciale non è attualmente disponibile su questo server.
                    La libreria <code className="bg-yellow-100 px-1 rounded">face_recognition</code> non è stata installata durante il deployment.
                  </p>
                  <p className="text-xs text-yellow-600 mt-2">
                    Contatta l'amministratore per abilitare questa funzionalità.
                  </p>
                </div>
              </div>
            </div>
          ) : consentData?.consent_given ? (
            <>
              {/* Consent given */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <div className="flex items-start space-x-3">
                  <Shield className="w-5 h-5 text-green-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-green-900 mb-1">✓ Consenso concesso</p>
                    <p className="text-sm text-green-700">
                      Il riconoscimento facciale è attivo. I volti nelle foto verranno rilevati e potrai etichettarli con nomi.
                    </p>
                    {consentData.consent_date && (
                      <p className="text-xs text-green-600 mt-2">
                        Consenso concesso il {new Date(consentData.consent_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => {
                    if (window.confirm('Revocare il consenso? Il sistema non rileverà più volti nelle nuove foto.')) {
                      revokeConsentMutation.mutate(false);
                    }
                  }}
                  disabled={revokeConsentMutation.isPending}
                  className="w-full px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 font-semibold transition-colors"
                >
                  {revokeConsentMutation.isPending ? 'Revoca in corso...' : 'Revoca consenso'}
                </button>

                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        'ATTENZIONE: Questa azione eliminerà permanentemente tutti i dati di riconoscimento facciale (volti rilevati e persone identificate). Le foto NON verranno eliminate. Continuare?'
                      )
                    ) {
                      revokeConsentMutation.mutate(true);
                    }
                  }}
                  disabled={revokeConsentMutation.isPending}
                  className="w-full px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-semibold transition-colors"
                >
                  {revokeConsentMutation.isPending ? 'Eliminazione in corso...' : 'Revoca ed elimina tutti i dati facciali'}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* No consent */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                <p className="text-gray-700 mb-4">
                  Il riconoscimento facciale permette di identificare automaticamente le persone nelle tue foto.
                  Potrai etichettare i volti con nomi e ritrovare facilmente tutte le foto di una persona.
                </p>
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <span>Rilevamento automatico dei volti nelle foto</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <span>Etichettatura con nomi personalizzati</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <span>Ricerca foto per persona</span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div className="flex items-start space-x-3">
                  <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-blue-900 mb-2">Privacy e GDPR</h3>
                    <ul className="space-y-1 text-sm text-blue-800">
                      <li>✓ Tutti i dati facciali sono conservati localmente sul tuo server</li>
                      <li>✓ Nessun dato viene inviato a servizi cloud esterni</li>
                      <li>✓ Puoi revocare il consenso in qualsiasi momento</li>
                      <li>✓ Opzione per eliminare tutti i dati di riconoscimento facciale</li>
                      <li>✓ Le foto originali non vengono mai modificate</li>
                    </ul>
                  </div>
                </div>
              </div>

              <button
                onClick={() => giveConsentMutation.mutate()}
                disabled={giveConsentMutation.isPending}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold transition-colors flex items-center justify-center space-x-2"
              >
                {giveConsentMutation.isPending ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    <span>Concessione in corso...</span>
                  </>
                ) : (
                  <>
                    <Shield className="w-5 h-5" />
                    <span>Concedi consenso per riconoscimento facciale</span>
                  </>
                )}
              </button>
            </>
          )}
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
