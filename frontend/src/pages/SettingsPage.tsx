import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import Layout from '../components/Layout';
import apiClient, { ollamaApi, remoteOllamaApi, facesApi } from '../api/client';
import type { ConsentResponse } from '../types';
import { Settings, Sparkles, Save, Loader, Wifi, WifiOff, RefreshCw, User, Shield, AlertCircle, Eye, MessageSquareText } from 'lucide-react';
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
  text_model: string;
  text_use_remote: boolean;
  created_at: string;
}

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
  const [textModel, setTextModel] = useState(profile?.text_model || 'llama3.2:latest');
  const [textUseRemote, setTextUseRemote] = useState(profile?.text_use_remote ?? false);

  // Modelli locali dal server Ollama
  const [localModels, setLocalModels] = useState<Array<{ name: string; size: number }>>([]);
  const [loadingLocalModels, setLoadingLocalModels] = useState(false);

  // Stati per remote server
  const [testingConnection, setTestingConnection] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; size: number }>>([]);
  const [allRemoteModels, setAllRemoteModels] = useState<Array<{ name: string; size: number }>>([]);
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
      setTextModel(profile.text_model || 'llama3.2:latest');
      setTextUseRemote(profile.text_use_remote ?? false);
    }
  }, [profile]);

  // Fetch modelli locali all'avvio
  useEffect(() => {
    const fetchLocalModels = async () => {
      setLoadingLocalModels(true);
      try {
        const data = await ollamaApi.getLocalModels();
        setLocalModels(data.models || []);
      } catch (err) {
        console.error('Failed to fetch local models:', err);
      } finally {
        setLoadingLocalModels(false);
      }
    };
    fetchLocalModels();
  }, []);

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
      text_model?: string;
      text_use_remote?: boolean;
    }) => {
      const params = new URLSearchParams();
      if (data.preferred_model) params.append('preferred_model', data.preferred_model);
      if (data.auto_analyze !== undefined) params.append('auto_analyze', String(data.auto_analyze));
      if (data.remote_ollama_enabled !== undefined) params.append('remote_ollama_enabled', String(data.remote_ollama_enabled));
      if (data.remote_ollama_url) params.append('remote_ollama_url', data.remote_ollama_url);
      if (data.remote_ollama_model) params.append('remote_ollama_model', data.remote_ollama_model);
      if (data.text_model) params.append('text_model', data.text_model);
      if (data.text_use_remote !== undefined) params.append('text_use_remote', String(data.text_use_remote));

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
    setAllRemoteModels([]);

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
          setAllRemoteModels(modelsData.all_models);

          if (modelsData.all_models.length === 0) {
            toast.error('Nessun modello disponibile sul server remoto');
          } else {
            toast.success(`Trovati ${modelsData.all_models.length} modelli (${modelsData.models.length} vision)`);
            // Auto-select first vision model if current not in list
            const currentVisionExists = modelsData.models.some((m) => m.name === remoteModel);
            if (!currentVisionExists && modelsData.models.length > 0) {
              setRemoteModel(modelsData.models[0].name);
            }
            // Auto-select first text model if current not in list
            const currentTextExists = modelsData.all_models.some((m) => m.name === textModel);
            if (!currentTextExists && modelsData.all_models.length > 0) {
              setTextModel(modelsData.all_models[0].name);
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
      let errorMsg = 'Errore di connessione';

      if (error.response?.data?.detail) {
        // FastAPI validation errors are arrays
        if (Array.isArray(error.response.data.detail)) {
          errorMsg = error.response.data.detail.map((e: any) => e.msg).join(', ');
        } else if (typeof error.response.data.detail === 'string') {
          errorMsg = error.response.data.detail;
        }
      } else if (error.message) {
        errorMsg = error.message;
      }

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
      text_model: textModel,
      text_use_remote: textUseRemote,
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
          <div className="flex items-center space-x-3 mb-4">
            <Eye className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Modello Vision (Analisi Foto)</h2>
              <p className="text-sm text-gray-600">Usato per descrivere e analizzare le immagini</p>
            </div>
          </div>

          {loadingLocalModels ? (
            <div className="flex items-center space-x-2 text-gray-500 py-4">
              <Loader className="w-5 h-5 animate-spin" />
              <span>Caricamento modelli...</span>
            </div>
          ) : localModels.length > 0 ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Modello</label>
              <select
                value={preferredModel}
                onChange={(e) => setPreferredModel(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                {localModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name} ({(model.size / 1024 / 1024 / 1024).toFixed(1)} GB)
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {localModels.length} modelli sul server locale.
                {remoteEnabled && ' Il server remoto verrà usato automaticamente quando abilitato.'}
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Modello</label>
              <input
                type="text"
                value={preferredModel}
                onChange={(e) => setPreferredModel(e.target.value)}
                placeholder="es. moondream, llava-phi3"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
              <p className="text-xs text-yellow-600 mt-1">
                Impossibile recuperare modelli dal server. Inserisci il nome manualmente.
              </p>
            </div>
          )}
        </div>

        {/* Text Model for Memory & Diary */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center space-x-3 mb-4">
            <MessageSquareText className="w-6 h-6 text-amber-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Modello Testo (Memoria e Diario)</h2>
              <p className="text-sm text-gray-600">Usato per Q&A memoria e generazione storie diario</p>
            </div>
          </div>

          {/* Toggle locale/remoto */}
          <div className="mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTextUseRemote(false)}
                className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                  !textUseRemote
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                Ollama Locale (server)
              </button>
              <button
                onClick={() => setTextUseRemote(true)}
                disabled={!remoteEnabled}
                className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                  textUseRemote
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                Ollama Remoto (PC)
              </button>
            </div>
            {!remoteEnabled && (
              <p className="text-xs text-gray-400 mt-2">
                Abilita il server remoto sotto per poter usarlo anche per il testo
              </p>
            )}
          </div>

          {/* Model selection */}
          {textUseRemote && allRemoteModels.length > 0 ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Modello</label>
              <select
                value={textModel}
                onChange={(e) => setTextModel(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              >
                {allRemoteModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name} ({(model.size / 1024 / 1024 / 1024).toFixed(1)} GB)
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Modelli disponibili sul server remoto</p>
            </div>
          ) : !textUseRemote && localModels.length > 0 ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Modello</label>
              <select
                value={textModel}
                onChange={(e) => setTextModel(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              >
                {localModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name} ({(model.size / 1024 / 1024 / 1024).toFixed(1)} GB)
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Modelli disponibili sul server locale</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Modello</label>
              <input
                type="text"
                value={textModel}
                onChange={(e) => setTextModel(e.target.value)}
                placeholder="es. llama3.2:latest, qwen3:latest"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                {textUseRemote
                  ? 'Testa la connessione remota per vedere i modelli disponibili'
                  : 'Nome del modello installato sul container Ollama del server'}
              </p>
            </div>
          )}
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
                    setConnectionTested(false);
                    setAvailableModels([]);
                    setAllRemoteModels([]);
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

              {/* Remote Model Selection */}
              {loadingModels ? (
                <div className="flex items-center justify-center py-4 text-gray-500">
                  <Loader className="w-5 h-5 animate-spin mr-2" />
                  <span>Caricamento modelli...</span>
                </div>
              ) : availableModels.length > 0 ? (
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Eye className="w-4 h-4 text-blue-600" />
                    Modello Vision (analisi foto)
                  </label>
                  <select
                    value={remoteModel}
                    onChange={(e) => setRemoteModel(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {availableModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name} ({(model.size / 1024 / 1024 / 1024).toFixed(1)} GB)
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Usato per descrivere e analizzare le immagini
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Modelli sul Server Remoto
                  </label>
                  <p className="text-xs text-yellow-600 flex items-center space-x-1 py-2">
                    <RefreshCw className="w-3 h-3" />
                    <span>Testa la connessione per vedere i modelli disponibili</span>
                  </p>
                </div>
              )}
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
