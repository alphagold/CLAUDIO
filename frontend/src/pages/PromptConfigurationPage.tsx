import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/Layout';
import apiClient from '../api/client';
import { MessageSquare, Save, RefreshCw, Check, X, Loader, AlertCircle, Eye, Edit3, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  prompt_text: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function PromptConfigurationPage() {
  const queryClient = useQueryClient();

  // State
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  const [editedPrompt, setEditedPrompt] = useState('');
  const [editedDescription, setEditedDescription] = useState('');

  // Variabili esempio per preview
  const [previewLocation, setPreviewLocation] = useState('Roma, Lazio, Italia');
  const [previewModel, setPreviewModel] = useState('qwen3-vl:latest');

  // Query: fetch templates
  const { data: templates, isLoading } = useQuery<PromptTemplate[]>({
    queryKey: ['prompts'],
    queryFn: async () => {
      const response = await apiClient.get('/api/admin/prompts');
      return response.data;
    },
  });

  // Selected template
  const selectedTemplate = templates?.find(t => t.id === selectedTemplateId);

  // Mutation: update template
  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; prompt_text: string; description: string }) => {
      const response = await apiClient.put(`/api/admin/prompts/${data.id}`, {
        prompt_text: data.prompt_text,
        description: data.description,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
      toast.success('Template aggiornato con successo!');
      setEditMode(false);
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.detail || 'Errore durante l\'aggiornamento';
      toast.error(errorMsg);
    },
  });

  // Mutation: set default
  const setDefaultMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const response = await apiClient.post(`/api/admin/prompts/${templateId}/set-default`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
      toast.success('Template impostato come default!');
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.detail || 'Errore durante l\'impostazione default';
      toast.error(errorMsg);
    },
  });

  // Mutation: reset all templates
  const resetMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/api/admin/prompts/reset');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
      toast.success('Template ripristinati ai valori di default!');
      setSelectedTemplateId(null);
      setEditMode(false);
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.detail || 'Errore durante il reset';
      toast.error(errorMsg);
    },
  });

  // Handlers
  const handleSelectTemplate = (templateId: string) => {
    const template = templates?.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplateId(templateId);
      setEditedPrompt(template.prompt_text);
      setEditedDescription(template.description);
      setEditMode(false);
      setPreviewMode(false);
    }
  };

  const handleStartEdit = () => {
    if (selectedTemplate) {
      setEditedPrompt(selectedTemplate.prompt_text);
      setEditedDescription(selectedTemplate.description);
      setEditMode(true);
      setPreviewMode(false);
    }
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    if (selectedTemplate) {
      setEditedPrompt(selectedTemplate.prompt_text);
      setEditedDescription(selectedTemplate.description);
    }
  };

  const handleSave = () => {
    if (!selectedTemplate) return;

    if (editedPrompt.trim().length < 50) {
      toast.error('Il prompt deve essere di almeno 50 caratteri');
      return;
    }

    updateMutation.mutate({
      id: selectedTemplate.id,
      prompt_text: editedPrompt,
      description: editedDescription,
    });
  };

  const handleSetDefault = () => {
    if (!selectedTemplate) return;

    if (confirm(`Impostare "${selectedTemplate.name}" come template predefinito?`)) {
      setDefaultMutation.mutate(selectedTemplate.id);
    }
  };

  const handleReset = () => {
    if (confirm('ATTENZIONE: Questa operazione ripristinerà TUTTI i template ai valori di default, eliminando le modifiche personalizzate. Continuare?')) {
      resetMutation.mutate();
    }
  };

  const handleTogglePreview = () => {
    setPreviewMode(!previewMode);
    if (!previewMode) {
      setEditMode(false);
    }
  };

  // Generate preview with variables substituted
  const generatePreview = () => {
    if (!editedPrompt) return '';

    const locationHint = previewLocation ? ` La foto è stata scattata a ${previewLocation}.` : '';

    return editedPrompt
      .replace('{location_hint}', locationHint)
      .replace('{model}', previewModel);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-blue-500" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Configurazione Prompt AI</h1>
              <p className="text-gray-600 mt-1">
                Personalizza i prompt usati per l'analisi delle foto
              </p>
            </div>
          </div>

          <button
            onClick={handleReset}
            disabled={resetMutation.isPending}
            className="btn btn-secondary flex items-center gap-2"
            title="Ripristina tutti i template ai valori di default"
          >
            {resetMutation.isPending ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Reset to Default
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Template List */}
            <div className="lg:col-span-1">
              <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-500" />
                  Template Disponibili
                </h2>

                <div className="space-y-2">
                  {templates?.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template.id)}
                      className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                        selectedTemplateId === template.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-900 mb-1">
                            {template.name}
                            {template.is_default && (
                              <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                                Default
                              </span>
                            )}
                          </h3>
                          <p className="text-sm text-gray-600 line-clamp-2">
                            {template.description}
                          </p>
                        </div>
                        {selectedTemplateId === template.id && (
                          <Check className="w-5 h-5 text-blue-500 flex-shrink-0 ml-2" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Template Editor/Preview */}
            <div className="lg:col-span-2">
              {selectedTemplate ? (
                <div className="card">
                  {/* Template Header */}
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        {selectedTemplate.name}
                        {selectedTemplate.is_default && (
                          <span className="text-sm bg-green-100 text-green-700 px-3 py-1 rounded-full">
                            Default
                          </span>
                        )}
                      </h2>
                      <p className="text-gray-600 mt-1">{selectedTemplate.description}</p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={handleTogglePreview}
                        className={`btn ${previewMode ? 'btn-primary' : 'btn-secondary'} flex items-center gap-2`}
                      >
                        <Eye className="w-4 h-4" />
                        {previewMode ? 'Modifica' : 'Preview'}
                      </button>

                      {!selectedTemplate.is_default && (
                        <button
                          onClick={handleSetDefault}
                          disabled={setDefaultMutation.isPending}
                          className="btn btn-secondary flex items-center gap-2"
                          title="Imposta come template predefinito"
                        >
                          {setDefaultMutation.isPending ? (
                            <Loader className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          Set Default
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Preview Mode */}
                  {previewMode ? (
                    <div className="space-y-4">
                      {/* Preview Variables */}
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          Variabili per Preview
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Location (opzionale)
                            </label>
                            <input
                              type="text"
                              value={previewLocation}
                              onChange={(e) => setPreviewLocation(e.target.value)}
                              placeholder="Es: Roma, Italia"
                              className="input input-sm w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Model Name
                            </label>
                            <input
                              type="text"
                              value={previewModel}
                              onChange={(e) => setPreviewModel(e.target.value)}
                              placeholder="Es: qwen3-vl:latest"
                              className="input input-sm w-full"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Preview Output */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Prompt Renderizzato (come verrà inviato all'AI)
                        </label>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                            {generatePreview()}
                          </pre>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          Lunghezza: {generatePreview().length} caratteri
                        </p>
                      </div>
                    </div>
                  ) : (
                    /* Edit Mode */
                    <div className="space-y-4">
                      {/* Description */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Descrizione
                        </label>
                        {editMode ? (
                          <input
                            type="text"
                            value={editedDescription}
                            onChange={(e) => setEditedDescription(e.target.value)}
                            className="input w-full"
                            placeholder="Descrizione del template..."
                          />
                        ) : (
                          <p className="text-gray-700 bg-gray-50 p-3 rounded-lg">
                            {selectedTemplate.description}
                          </p>
                        )}
                      </div>

                      {/* Prompt Text */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
                          <span>Prompt Template</span>
                          {!editMode && (
                            <button
                              onClick={handleStartEdit}
                              className="btn btn-sm btn-secondary flex items-center gap-1"
                            >
                              <Edit3 className="w-3 h-3" />
                              Modifica
                            </button>
                          )}
                        </label>

                        {editMode ? (
                          <textarea
                            value={editedPrompt}
                            onChange={(e) => setEditedPrompt(e.target.value)}
                            rows={20}
                            className="input w-full font-mono text-sm"
                            placeholder="Inserisci il prompt template..."
                          />
                        ) : (
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                              {selectedTemplate.prompt_text}
                            </pre>
                          </div>
                        )}

                        <div className="flex items-center justify-between mt-2">
                          <p className="text-xs text-gray-500">
                            Lunghezza: {editMode ? editedPrompt.length : selectedTemplate.prompt_text.length} caratteri
                            {editMode && editedPrompt.length < 50 && (
                              <span className="text-red-500 ml-2">(minimo 50)</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500">
                            Variabili disponibili: <code>{'{location_hint}'}</code>, <code>{'{model}'}</code>
                          </p>
                        </div>
                      </div>

                      {/* Edit Actions */}
                      {editMode && (
                        <div className="flex items-center justify-end gap-3 pt-4 border-t">
                          <button
                            onClick={handleCancelEdit}
                            disabled={updateMutation.isPending}
                            className="btn btn-secondary flex items-center gap-2"
                          >
                            <X className="w-4 h-4" />
                            Annulla
                          </button>
                          <button
                            onClick={handleSave}
                            disabled={updateMutation.isPending || editedPrompt.length < 50}
                            className="btn btn-primary flex items-center gap-2"
                          >
                            {updateMutation.isPending ? (
                              <>
                                <Loader className="w-4 h-4 animate-spin" />
                                Salvataggio...
                              </>
                            ) : (
                              <>
                                <Save className="w-4 h-4" />
                                Salva Modifiche
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Template Info */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                        <h3 className="text-sm font-semibold text-blue-900 mb-2">
                          ℹ️ Informazioni Template
                        </h3>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                          <dt className="text-gray-600">Creato:</dt>
                          <dd className="text-gray-900">
                            {new Date(selectedTemplate.created_at).toLocaleString('it-IT')}
                          </dd>
                          <dt className="text-gray-600">Ultimo aggiornamento:</dt>
                          <dd className="text-gray-900">
                            {new Date(selectedTemplate.updated_at).toLocaleString('it-IT')}
                          </dd>
                          <dt className="text-gray-600">ID:</dt>
                          <dd className="text-gray-900 font-mono text-xs">{selectedTemplate.id}</dd>
                        </dl>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="card">
                  <div className="text-center py-12">
                    <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      Seleziona un Template
                    </h3>
                    <p className="text-gray-600">
                      Scegli un template dalla lista per visualizzarlo o modificarlo
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
