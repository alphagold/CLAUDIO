import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Camera, BookOpen, Calendar, Sparkles, MapPin, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import Layout from '../components/Layout';
import { diaryApi, photosApi } from '../api/client';
import type { PersonDiary, PersonStory, DiaryChapter } from '../types';
import toast from 'react-hot-toast';

export default function PersonDiaryPage() {
  const { personId } = useParams<{ personId: string }>();
  const navigate = useNavigate();
  const [diary, setDiary] = useState<PersonDiary | null>(null);
  const [loading, setLoading] = useState(true);
  const [story, setStory] = useState<PersonStory | null>(null);
  const [generatingStory, setGeneratingStory] = useState(false);
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (personId) fetchDiary();
  }, [personId]);

  const fetchDiary = async () => {
    try {
      setLoading(true);
      const data = await diaryApi.getPersonDiary(personId!);
      setDiary(data);
      // Espandi il primo capitolo di default
      if (data.chapters.length > 0) {
        setExpandedChapters(new Set([1]));
      }
    } catch {
      toast.error('Errore nel caricamento del diario');
      navigate('/people');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateStory = async () => {
    if (!personId || generatingStory) return;
    setGeneratingStory(true);
    try {
      const result = await diaryApi.generatePersonStory(personId);
      setStory(result);
      toast.success('Storia generata con successo');
    } catch {
      toast.error('Errore nella generazione della storia. Il modello potrebbe non essere disponibile.');
    } finally {
      setGeneratingStory(false);
    }
  };

  const toggleChapter = (chapterNum: number) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterNum)) {
        next.delete(chapterNum);
      } else {
        next.add(chapterNum);
      }
      return next;
    });
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 64px)' }}>
          <Loader className="w-10 h-10 animate-spin text-blue-500" />
        </div>
      </Layout>
    );
  }

  if (!diary) return null;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/people')}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Torna a Persone</span>
          </button>

          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <BookOpen className="w-8 h-8 text-amber-600" />
                Diario di {diary.person.name}
              </h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <Camera className="w-4 h-4" />
                  {diary.total_photos} foto
                </span>
                <span className="flex items-center gap-1">
                  <BookOpen className="w-4 h-4" />
                  {diary.total_chapters} capitoli
                </span>
                {diary.person.first_seen_at && diary.person.last_seen_at && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {formatDate(diary.person.first_seen_at)} - {formatDate(diary.person.last_seen_at)}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={handleGenerateStory}
              disabled={generatingStory || diary.total_chapters === 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
            >
              {generatingStory ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {generatingStory ? 'Generazione...' : 'Genera storia'}
            </button>
          </div>
        </div>

        {/* Story card */}
        {story && (
          <div className="mb-8 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 text-amber-600" />
              <h2 className="text-lg font-semibold text-amber-900">
                La storia di {story.person_name}
              </h2>
              <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full ml-auto">
                {story.model} | {story.photo_count} foto
              </span>
            </div>
            <div className="prose prose-amber max-w-none">
              {story.story.split('\n').map((paragraph, i) => (
                paragraph.trim() && <p key={i} className="text-gray-800 leading-relaxed">{paragraph}</p>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {diary.total_chapters === 0 && (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <Camera className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-semibold text-gray-700 mb-2">Nessun capitolo</h2>
            <p className="text-gray-500">
              Non ci sono ancora foto analizzate con date per questa persona.
            </p>
          </div>
        )}

        {/* Timeline */}
        {diary.chapters.length > 0 && (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" />

            <div className="space-y-6">
              {diary.chapters.map((chapter: DiaryChapter) => {
                const isExpanded = expandedChapters.has(chapter.chapter_num);

                return (
                  <div key={chapter.chapter_num} className="relative pl-14">
                    {/* Timeline dot */}
                    <div className="absolute left-4 top-5 w-5 h-5 rounded-full bg-white border-4 border-blue-500 z-10" />

                    {/* Chapter card */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                      <button
                        onClick={() => toggleChapter(chapter.chapter_num)}
                        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                      >
                        <div className="text-left">
                          <h3 className="font-semibold text-gray-900">{chapter.title}</h3>
                          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                              <Camera className="w-3.5 h-3.5" />
                              {chapter.photo_count} foto
                            </span>
                            {chapter.locations.length > 0 && (
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5" />
                                {chapter.locations.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="px-5 pb-5 border-t border-gray-100">
                          {/* Photo grid */}
                          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-4">
                            {chapter.photos.map((photo) => (
                              <Link
                                key={photo.id}
                                to={`/photos/${photo.id}`}
                                className="aspect-square rounded-lg overflow-hidden bg-gray-100 hover:ring-2 hover:ring-blue-500 transition-all"
                              >
                                <img
                                  src={photosApi.getThumbnailUrl(photo.id, 128)}
                                  alt={photo.description_short || ''}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              </Link>
                            ))}
                          </div>

                          {/* Photo descriptions */}
                          {chapter.photos.some(p => p.description_short) && (
                            <div className="mt-4 space-y-2">
                              {chapter.photos.map((photo) =>
                                photo.description_short ? (
                                  <p key={photo.id} className="text-sm text-gray-600">
                                    <span className="text-gray-400">
                                      {photo.taken_at ? new Date(photo.taken_at).toLocaleDateString('it-IT') : ''}
                                    </span>
                                    {' '}{photo.description_short}
                                  </p>
                                ) : null
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
