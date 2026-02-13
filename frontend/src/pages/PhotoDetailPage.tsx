import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { photosApi, facesApi } from '../api/client';
import apiClient from '../api/client';
import Layout from '../components/Layout';
import PhotoMap from '../components/PhotoMap';
import FaceOverlay from '../components/FaceOverlay';
import type { Face, Person } from '../types';
import {
  ArrowLeft,
  Loader,
  Calendar,
  Tag,
  Eye,
  FileText,
  Trash2,
  Clock,
  Sparkles,
  RefreshCw,
  X,
  Zap,
  Camera,
  Edit3,
  MapPin,
  CheckCircle,
  Users,
  UserPlus,
  Pencil,
  Maximize2,
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function PhotoDetailPage() {
  const { photoId } = useParams<{ photoId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedFace, setSelectedFace] = useState<Face | null>(null);
  const [showFaceLabelDialog, setShowFaceLabelDialog] = useState(false);
  const [labelPersonName, setLabelPersonName] = useState('');
  const [labelPersonId, setLabelPersonId] = useState<string>('');
  const [isDrawingFace, setIsDrawingFace] = useState(false);
  const [manualBbox, setManualBbox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [faceRefreshKey, setFaceRefreshKey] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);

  // Reset scroll all'apertura
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [photoId]);

  // Chiudi lightbox con Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showLightbox) setShowLightbox(false);
        else if (showFaceLabelDialog) setShowFaceLabelDialog(false);
        else if (showModelDialog) setShowModelDialog(false);
        else if (showEditDialog) setShowEditDialog(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showLightbox, showFaceLabelDialog, showModelDialog, showEditDialog]);

  const { data: persons = [] } = useQuery({
    queryKey: ['persons'],
    queryFn: () => facesApi.listPersons(),
  });

  const { data: photoFaces = [] } = useQuery({
    queryKey: ['photoFaces', photoId, faceRefreshKey],
    queryFn: () => facesApi.getPhotoFaces(photoId!),
    enabled: !!photoId,
  });

  const { data: photo, isLoading } = useQuery({
    queryKey: ['photo', photoId],
    queryFn: () => photosApi.getPhoto(photoId!),
    enabled: !!photoId,
    refetchInterval: (query) => {
      const photo = query.state.data;
      const llmInProgress = photo && !photo.analyzed_at && photo.analysis_started_at;
      const faceInProgress = photo?.face_detection_status === 'processing' || photo?.face_detection_status === 'pending';
      return (llmInProgress || faceInProgress) ? 1000 : false;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: async () => {
      const response = await apiClient.get('/api/user/profile');
      return response.data;
    },
  });

  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const deleteMutation = useMutation({
    mutationFn: () => photosApi.deletePhoto(photoId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      toast.success('Foto eliminata');
      navigate('/gallery');
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: (model: string) => photosApi.reanalyzePhoto(photoId!, model),
    onSuccess: () => {
      toast.success('Rianalisi avviata');
      setShowModelDialog(false);
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
    },
    onError: () => toast.error('Errore rianalisi'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { taken_at?: string; latitude?: number; longitude?: number; location_name?: string }) =>
      photosApi.updatePhoto(photoId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      toast.success('Foto aggiornata');
      setShowEditDialog(false);
    },
    onError: () => toast.error('Errore aggiornamento'),
  });

  const labelFaceMutation = useMutation({
    mutationFn: (data: { faceId: string; personId?: string; personName?: string }) =>
      facesApi.labelFace(data.faceId, {
        person_id: data.personId,
        person_name: data.personName,
      }),
    onSuccess: () => {
      toast.success('Volto etichettato');
      setShowFaceLabelDialog(false);
      setSelectedFace(null);
      setFaceRefreshKey(k => k + 1);
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
    onError: () => toast.error('Errore etichettatura'),
  });

  const addManualFaceMutation = useMutation({
    mutationFn: (data: { bbox: { x: number; y: number; width: number; height: number }; personId?: string; personName?: string }) =>
      facesApi.addManualFace(photoId!, {
        bbox_x: data.bbox.x,
        bbox_y: data.bbox.y,
        bbox_width: data.bbox.width,
        bbox_height: data.bbox.height,
        person_id: data.personId,
        person_name: data.personName,
      }),
    onSuccess: () => {
      toast.success('Volto aggiunto');
      setShowFaceLabelDialog(false);
      setManualBbox(null);
      setIsDrawingFace(false);
      setFaceRefreshKey(k => k + 1);
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || 'Errore aggiunta volto'),
  });

  const deleteFaceMutation = useMutation({
    mutationFn: (faceId: string) => facesApi.deleteFace(faceId),
    onSuccess: () => {
      toast.success('Volto rimosso');
      setFaceRefreshKey(k => k + 1);
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
    onError: () => toast.error('Errore rimozione volto'),
  });

  const redetectFacesMutation = useMutation({
    mutationFn: () => facesApi.detectFaces(photoId!),
    onSuccess: () => {
      toast.success('Rilevamento volti completato');
      setFaceRefreshKey(k => k + 1);
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || 'Errore rilevamento volti'),
  });

  const handleRedetectFaces = () => {
    if (photo?.face_detection_status === 'completed' && photoFaces.length > 0) {
      if (!window.confirm('Ri-analisi eliminerà i volti esistenti. Continuare?')) return;
    }
    redetectFacesMutation.mutate();
  };

  const handleManualFaceDrawn = (bbox: { x: number; y: number; width: number; height: number }) => {
    setManualBbox(bbox);
    setIsDrawingFace(false);
    setSelectedFace(null);
    setLabelPersonId('');
    setLabelPersonName('');
    setShowFaceLabelDialog(true);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
      + ', ' + date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
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

  if (!photo) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <p className="text-gray-600">Foto non trovata</p>
        </div>
      </Layout>
    );
  }

  const labeledFaces = photoFaces.filter(f => f.person_name);

  return (
    <Layout>
      <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden">
        {/* Top bar compatta */}
        <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0">
          <button
            onClick={() => navigate('/gallery')}
            className="flex items-center space-x-1.5 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Galleria</span>
          </button>

          <div className="flex items-center space-x-1">
            {/* Analysis status chip */}
            {!photo.analyzed_at && photo.analysis_started_at ? (
              <span className="flex items-center space-x-1 px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs">
                <Loader className="w-3 h-3 animate-spin" />
                <span>Analisi in corso {photo.elapsed_time_seconds ? formatElapsedTime(photo.elapsed_time_seconds) : ''}</span>
              </span>
            ) : photo.analyzed_at ? (
              <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                {photo.analysis?.model_version || 'Analizzata'}
              </span>
            ) : null}

            <button
              onClick={() => setShowModelDialog(true)}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
              title="Rianalizza con AI"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowInfoPanel(!showInfoPanel)}
              className={`p-1.5 rounded transition-colors ${showInfoPanel ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
              title="Mostra/nascondi info"
            >
              <FileText className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowEditDialog(true)}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors"
              title="Modifica metadati"
            >
              <Edit3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => { if (window.confirm('Eliminare questa foto?')) deleteMutation.mutate(); }}
              className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
              title="Elimina foto"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main content area - foto + sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* Foto - 70% viewport */}
          <div className="flex-1 flex items-center justify-center bg-gray-900 relative min-w-0">
            <div className="w-full h-full flex items-center justify-center p-2">
              <div
                className="relative max-h-full cursor-pointer"
                style={{ maxWidth: '100%' }}
                onClick={() => !isDrawingFace && setShowLightbox(true)}
              >
                <FaceOverlay
                  photoId={photo.id}
                  imageUrl={photosApi.getPhotoUrl(photo.id)}
                  onFaceClick={(face) => {
                    if (isDrawingFace) return;
                    setSelectedFace(face);
                    setManualBbox(null);
                    setLabelPersonId(face.person_id || '');
                    setLabelPersonName('');
                    setShowFaceLabelDialog(true);
                  }}
                  showLabels={true}
                  className="max-h-[calc(100vh-120px)] w-auto"
                  refreshTrigger={`${photo.faces_detected_at}_${faceRefreshKey}`}
                  drawMode={isDrawingFace}
                  onManualFaceDrawn={handleManualFaceDrawn}
                />
              </div>
            </div>

            {/* Enlarge hint */}
            {!isDrawingFace && (
              <div className="absolute bottom-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded flex items-center space-x-1 pointer-events-none">
                <Maximize2 className="w-3 h-3" />
                <span>Click per ingrandire</span>
              </div>
            )}
          </div>

          {/* Sidebar destra - volti + info collassabile */}
          <div className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-y-auto flex-shrink-0">
            {/* Faces panel */}
            <div className="p-3 border-b border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-1.5">
                  <Users className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-900">Volti</span>
                  {photoFaces.length > 0 && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                      {labeledFaces.length}/{photoFaces.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setIsDrawingFace(!isDrawingFace)}
                    className={`p-1 rounded text-xs transition-colors ${
                      isDrawingFace ? 'bg-green-600 text-white' : 'text-green-700 hover:bg-green-50'
                    }`}
                    title="Aggiungi volto manualmente"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleRedetectFaces}
                    disabled={redetectFacesMutation.isPending}
                    className="p-1 text-blue-600 hover:bg-blue-50 rounded text-xs disabled:opacity-50 transition-colors"
                    title="Rianalizza volti"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${redetectFacesMutation.isPending ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Status */}
              {photo.face_detection_status === 'processing' && (
                <div className="flex items-center space-x-1 text-xs text-blue-600 mb-2">
                  <Loader className="w-3 h-3 animate-spin" />
                  <span>Rilevamento in corso...</span>
                </div>
              )}

              {/* Lista volti */}
              {photoFaces.length > 0 ? (
                <div className="space-y-1">
                  {photoFaces.map((face) => (
                    <div
                      key={face.id}
                      className="flex items-center justify-between p-1.5 rounded-lg hover:bg-gray-50 transition-colors group"
                    >
                      <div
                        className="flex items-center space-x-2 flex-1 min-w-0 cursor-pointer"
                        onClick={() => {
                          setSelectedFace(face);
                          setManualBbox(null);
                          setLabelPersonId(face.person_id || '');
                          setLabelPersonName('');
                          setShowFaceLabelDialog(true);
                        }}
                      >
                        <div
                          className="w-8 h-8 rounded overflow-hidden border border-gray-200 bg-gray-100 flex-shrink-0"
                          style={{
                            backgroundImage: `url(${photosApi.getPhotoUrl(photo.id)})`,
                            backgroundPosition: photo.width && photo.height
                              ? `-${(face.bbox.x / photo.width) * 32 * (photo.width / face.bbox.width)}px -${(face.bbox.y / photo.height) * 32 * (photo.height / face.bbox.height)}px`
                              : 'center',
                            backgroundSize: photo.width && face.bbox.width
                              ? `${(photo.width / face.bbox.width) * 32}px auto`
                              : 'cover',
                          }}
                        />
                        <div className="min-w-0">
                          <div className={`text-xs font-medium truncate ${face.person_name ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                            {face.person_name || 'Sconosciuto'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => {
                            setSelectedFace(face);
                            setManualBbox(null);
                            setLabelPersonId(face.person_id || '');
                            setLabelPersonName('');
                            setShowFaceLabelDialog(true);
                          }}
                          className="p-0.5 text-blue-500 hover:bg-blue-50 rounded"
                          title="Etichetta"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('Rimuovere questo volto?')) {
                              deleteFaceMutation.mutate(face.id);
                            }
                          }}
                          disabled={deleteFaceMutation.isPending}
                          className="p-0.5 text-red-400 hover:bg-red-50 rounded"
                          title="Rimuovi volto"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">
                  {photo.face_detection_status === 'no_faces' ? 'Nessun volto rilevato' :
                   photo.face_detection_status === 'pending' ? 'In attesa di analisi' :
                   'Usa "+" per aggiungere manualmente'}
                </p>
              )}
            </div>

            {/* Info compatte */}
            <div className="p-3 border-b border-gray-100 text-xs text-gray-600 space-y-1.5">
              <div className="flex items-center space-x-1.5">
                <Calendar className="w-3 h-3 text-gray-400" />
                <span>{formatDate(photo.taken_at || photo.uploaded_at)}</span>
              </div>
              {photo.location_name && (
                <div className="flex items-center space-x-1.5">
                  <MapPin className="w-3 h-3 text-gray-400" />
                  <span>{photo.location_name}</span>
                </div>
              )}
              {photo.width && photo.height && (
                <div className="flex items-center space-x-1.5">
                  <Camera className="w-3 h-3 text-gray-400" />
                  <span>{photo.width}x{photo.height} {photo.file_size ? `(${(photo.file_size / 1024 / 1024).toFixed(1)}MB)` : ''}</span>
                </div>
              )}
            </div>

            {/* Tags compatti */}
            {photo.analysis?.tags && photo.analysis.tags.length > 0 && (
              <div className="p-3 border-b border-gray-100">
                <div className="flex flex-wrap gap-1">
                  {photo.analysis.tags.map((tag, idx) => (
                    <span key={idx} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Info panel collassabile */}
            {showInfoPanel && (
              <div className="flex-1 overflow-y-auto">
                {/* Descrizione AI */}
                {photo.analysis?.description_full && (
                  <div className="p-3 border-b border-gray-100">
                    <div className="flex items-center space-x-1 mb-1.5">
                      <Sparkles className="w-3 h-3 text-green-600" />
                      <span className="text-xs font-semibold text-gray-700">Descrizione AI</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{photo.analysis.description_full}</p>
                  </div>
                )}

                {/* Oggetti */}
                {photo.analysis?.detected_objects && photo.analysis.detected_objects.length > 0 && (
                  <div className="p-3 border-b border-gray-100">
                    <div className="flex items-center space-x-1 mb-1.5">
                      <Eye className="w-3 h-3 text-purple-600" />
                      <span className="text-xs font-semibold text-gray-700">Oggetti</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {photo.analysis.detected_objects.map((obj, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded text-xs">{obj}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Testo estratto */}
                {photo.analysis?.extracted_text && (
                  <div className="p-3 border-b border-gray-100">
                    <div className="flex items-center space-x-1 mb-1.5">
                      <FileText className="w-3 h-3 text-orange-600" />
                      <span className="text-xs font-semibold text-gray-700">Testo</span>
                    </div>
                    <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded">{photo.analysis.extracted_text}</p>
                  </div>
                )}

                {/* Categoria scena */}
                {photo.analysis?.scene_category && (
                  <div className="p-3 border-b border-gray-100">
                    <div className="flex items-center space-x-1 mb-1.5">
                      <Tag className="w-3 h-3 text-indigo-600" />
                      <span className="text-xs font-semibold text-gray-700">Scena</span>
                    </div>
                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs">
                      {photo.analysis.scene_category}
                      {photo.analysis.scene_subcategory ? ` / ${photo.analysis.scene_subcategory}` : ''}
                    </span>
                  </div>
                )}

                {/* EXIF compatto */}
                {photo.exif_data && Object.keys(photo.exif_data).length > 0 && (
                  <div className="p-3 border-b border-gray-100">
                    <details>
                      <summary className="text-xs font-semibold text-gray-700 cursor-pointer hover:text-blue-600">
                        EXIF ({Object.keys(photo.exif_data).length} campi)
                      </summary>
                      <div className="mt-2 space-y-1">
                        {Object.entries(photo.exif_data).map(([key, value]) => (
                          <div key={key} className="flex justify-between text-xs">
                            <span className="text-gray-500">{key}</span>
                            <span className="text-gray-700 font-mono truncate ml-2 max-w-[120px]" title={String(value)}>{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                )}

                {/* Analisi meta */}
                {photo.analyzed_at && (
                  <div className="p-3 text-xs text-gray-400 space-y-0.5">
                    <div>Analizzata: {formatDateTime(photo.analyzed_at)}</div>
                    {photo.analysis?.processing_time_ms && (
                      <div>Tempo: {(photo.analysis.processing_time_ms / 1000).toFixed(1)}s</div>
                    )}
                    {photo.analysis_duration_seconds && (
                      <div>Durata totale: {formatElapsedTime(photo.analysis_duration_seconds)}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Map compatta */}
            {photo.latitude && photo.longitude && (
              <div className="flex-shrink-0">
                <PhotoMap
                  latitude={photo.latitude}
                  longitude={photo.longitude}
                  locationName={photo.location_name}
                  takenAt={photo.taken_at || photo.uploaded_at}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox fullscreen */}
      {showLightbox && (
        <div
          className="fixed inset-0 bg-black z-50 flex items-center justify-center"
          onClick={() => setShowLightbox(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white z-10 p-2"
            onClick={() => setShowLightbox(false)}
          >
            <X className="w-8 h-8" />
          </button>
          <img
            src={photosApi.getPhotoUrl(photo.id)}
            alt="Fullscreen"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Face Label Dialog */}
      {showFaceLabelDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-sm w-full shadow-2xl">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 rounded-t-xl">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <Users className="w-5 h-5 text-white" />
                  <h3 className="text-lg font-bold text-white">
                    {manualBbox ? 'Nuovo Volto' : 'Chi è?'}
                  </h3>
                </div>
                <button
                  onClick={() => { setShowFaceLabelDialog(false); setManualBbox(null); setSelectedFace(null); }}
                  className="text-white hover:bg-white/20 rounded-lg p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-5">
              {selectedFace?.person_name && !manualBbox && (
                <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                  Attuale: <strong>{selectedFace.person_name}</strong>
                </div>
              )}

              <div className="space-y-3">
                {persons.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Persona esistente</label>
                    <select
                      value={labelPersonId}
                      onChange={(e) => { setLabelPersonId(e.target.value); setLabelPersonName(''); }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">-- Seleziona --</option>
                      {persons.map((person: Person) => (
                        <option key={person.id} value={person.id}>
                          {person.name || `Person ${person.id.slice(0, 8)}`} ({person.photo_count})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {persons.length > 0 && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-300" /></div>
                    <div className="relative flex justify-center text-xs"><span className="px-2 bg-white text-gray-400">oppure</span></div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Nuova persona</label>
                  <input
                    type="text"
                    value={labelPersonName}
                    onChange={(e) => { setLabelPersonName(e.target.value); setLabelPersonId(''); }}
                    placeholder="Es: Mario Rossi"
                    autoFocus
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (labelPersonId || labelPersonName.trim())) {
                        e.preventDefault();
                        if (manualBbox) {
                          addManualFaceMutation.mutate({ bbox: manualBbox, personId: labelPersonId || undefined, personName: labelPersonName.trim() || undefined });
                        } else if (selectedFace) {
                          labelFaceMutation.mutate({ faceId: selectedFace.id, personId: labelPersonId || undefined, personName: labelPersonName.trim() || undefined });
                        }
                      }
                    }}
                  />
                </div>

                <div className="flex space-x-2 pt-1">
                  <button
                    onClick={() => { setShowFaceLabelDialog(false); setManualBbox(null); setSelectedFace(null); }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
                  >
                    Annulla
                  </button>
                  {manualBbox && (
                    <button
                      onClick={() => addManualFaceMutation.mutate({ bbox: manualBbox })}
                      disabled={addManualFaceMutation.isPending}
                      className="px-3 py-2 border border-green-300 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50 text-sm font-medium"
                    >
                      Solo Volto
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!labelPersonId && !labelPersonName.trim()) { toast.error('Seleziona o inserisci un nome'); return; }
                      if (manualBbox) {
                        addManualFaceMutation.mutate({ bbox: manualBbox, personId: labelPersonId || undefined, personName: labelPersonName.trim() || undefined });
                      } else if (selectedFace) {
                        labelFaceMutation.mutate({ faceId: selectedFace.id, personId: labelPersonId || undefined, personName: labelPersonName.trim() || undefined });
                      }
                    }}
                    disabled={(labelFaceMutation.isPending || addManualFaceMutation.isPending) || (!labelPersonId && !labelPersonName.trim())}
                    className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center space-x-1"
                  >
                    {(labelFaceMutation.isPending || addManualFaceMutation.isPending) ? (
                      <Loader className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Salva</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Model Selection Dialog */}
      {showModelDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Scegli Modello AI</h3>
              <button onClick={() => setShowModelDialog(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2">
              {[
                { id: 'moondream', name: 'Moondream', desc: '1.7GB ~10s', color: 'green', icon: Zap },
                { id: 'llava-phi3', name: 'LLaVA-Phi3', desc: '3.8GB ~30s', color: 'blue', icon: Zap },
                { id: 'qwen3-vl:latest', name: 'Qwen3-VL', desc: '4GB ~1min', color: 'indigo', icon: Sparkles },
                { id: 'llava:latest', name: 'LLaVA', desc: '4.5GB ~45s', color: 'cyan', icon: Sparkles },
                { id: 'llama3.2-vision', name: 'Llama 3.2 Vision', desc: '11B ~10min', color: 'purple', icon: Sparkles },
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => reanalyzeMutation.mutate(m.id)}
                  disabled={reanalyzeMutation.isPending}
                  className={`w-full p-3 text-left border-2 border-${m.color}-200 rounded-lg hover:border-${m.color}-400 hover:bg-${m.color}-50 transition-colors disabled:opacity-50`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">{m.name}</span>
                    <span className="text-xs text-gray-500">{m.desc}</span>
                  </div>
                </button>
              ))}
              {profile?.remote_ollama_enabled && (
                <button
                  onClick={() => reanalyzeMutation.mutate('remote')}
                  disabled={reanalyzeMutation.isPending}
                  className="w-full p-3 text-left border-2 border-purple-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">Server Remoto ({profile.remote_ollama_model})</span>
                    <span className="text-xs text-gray-500">Velocissimo</span>
                  </div>
                </button>
              )}
            </div>
            {reanalyzeMutation.isPending && (
              <div className="mt-3 flex items-center justify-center space-x-2 text-blue-600">
                <Loader className="w-4 h-4 animate-spin" />
                <span className="text-sm">Avvio...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Photo Dialog */}
      {showEditDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full shadow-2xl">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-3 rounded-t-xl flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <Edit3 className="w-5 h-5 text-white" />
                <h3 className="text-lg font-bold text-white">Modifica Metadati</h3>
              </div>
              <button onClick={() => setShowEditDialog(false)} className="text-white hover:bg-white/20 rounded p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <EditPhotoForm
              photo={photo}
              onSubmit={(data) => updateMutation.mutate(data)}
              onCancel={() => setShowEditDialog(false)}
              isPending={updateMutation.isPending}
            />
          </div>
        </div>
      )}
    </Layout>
  );
}

// Componente separato per il form di modifica (evita re-render stato)
function EditPhotoForm({ photo, onSubmit, onCancel, isPending }: {
  photo: any;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    taken_at: photo?.taken_at ? new Date(photo.taken_at).toISOString().slice(0, 16) : '',
    latitude: photo?.latitude?.toString() || '',
    longitude: photo?.longitude?.toString() || '',
    location_name: photo?.location_name || '',
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data: any = {};
        if (formData.taken_at) data.taken_at = new Date(formData.taken_at).toISOString();
        if (formData.latitude) data.latitude = parseFloat(formData.latitude);
        if (formData.longitude) data.longitude = parseFloat(formData.longitude);
        if (formData.location_name) data.location_name = formData.location_name;
        onSubmit(data);
      }}
      className="p-5 space-y-4"
    >
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Data Scatto</label>
        <input
          type="datetime-local"
          value={formData.taken_at}
          onChange={(e) => setFormData({ ...formData, taken_at: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Luogo</label>
        <input
          type="text"
          value={formData.location_name}
          onChange={(e) => setFormData({ ...formData, location_name: e.target.value })}
          placeholder="Es: Roma, Colosseo"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Latitudine</label>
          <input
            type="number"
            step="any"
            value={formData.latitude}
            onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
            placeholder="41.9028"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Longitudine</label>
          <input
            type="number"
            step="any"
            value={formData.longitude}
            onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
            placeholder="12.4964"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div className="flex space-x-3 pt-2">
        <button type="button" onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium">
          Annulla
        </button>
        <button type="submit" disabled={isPending} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center space-x-1">
          {isPending ? <Loader className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4" /><span>Salva</span></>}
        </button>
      </div>
    </form>
  );
}
