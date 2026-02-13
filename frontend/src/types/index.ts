// User types
export interface User {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  created_at: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// Photo types
export interface PhotoAnalysis {
  description_full: string;
  description_short: string | null;
  extracted_text: string | null;
  detected_objects: string[] | null;
  detected_faces: number;
  scene_category: string | null;
  scene_subcategory: string | null;
  tags: string[] | null;
  model_version: string | null;
  processing_time_ms: number | null;
  confidence_score: number | null;
}

export interface Photo {
  id: string;
  user_id: string;
  original_path: string;
  thumbnail_128_path: string | null;
  thumbnail_512_path: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  taken_at: string;
  uploaded_at: string;
  analysis_started_at: string | null;
  analyzed_at: string | null;
  analysis_duration_seconds: number | null;
  elapsed_time_seconds?: number | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  has_text: boolean;
  has_faces: boolean;
  is_food: boolean;
  is_document: boolean;
  exif_data: Record<string, any> | null;
  face_detection_status: string | null;
  faces_detected_at: string | null;
  analysis: PhotoAnalysis | null;
}

export interface PhotoUploadResponse {
  photo: Photo;
  message: string;
}

export interface PhotosResponse {
  photos: Photo[];
  total: number;
  skip: number;
  limit: number;
}

export interface QueueStatus {
  queue_size: number;
  worker_running: boolean;
  current_photo: {
    id: string;
    filename: string;
    analysis_started_at: string | null;
    elapsed_seconds: number;
  } | null;
  total_in_progress: number;
}

// Album types
export interface Album {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  cover_photo_id: string | null;
  created_at: string;
  updated_at: string;
  photo_count?: number;
}

export interface CreateAlbumRequest {
  name: string;
  description?: string;
}

// Search types
export interface SearchQuery {
  query?: string;
  scene_category?: string;
  tags?: string[];
  date_from?: string;
  date_to?: string;
  limit?: number;
  skip?: number;
}

// Face Recognition types
export interface Face {
  id: string;
  person_id: string | null;
  person_name: string | null;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  quality_score: number | null;
  cluster_id: number | null;
}

export interface Person {
  id: string;
  name: string | null;
  notes: string | null;
  photo_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  is_verified: boolean;
  representative_face_id: string | null;
  representative_photo_id?: string | null;
  representative_bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export interface PersonUpdateRequest {
  name?: string;
  notes?: string;
  is_verified?: boolean;
}

export interface FaceLabelRequest {
  person_id?: string;
  person_name?: string;
}

export interface SimilarFace {
  face_id: string;
  person_id: string | null;
  person_name: string | null;
  similarity: number;
  distance: number;
}

export interface Cluster {
  cluster_id: number;
  face_count: number;
  faces: string[];
  representative_face: string | null;
}

export interface ConsentResponse {
  consent_given: boolean;
  consent_date: string | null;
  can_use_face_recognition: boolean;
}

export interface FaceDetectionResponse {
  photo_id: string;
  faces_detected: number;
  status: string;
}

export interface ManualFaceRequest {
  bbox_x: number;
  bbox_y: number;
  bbox_width: number;
  bbox_height: number;
  person_name?: string;
  person_id?: string;
}

// Diary types
export interface DiaryPhoto {
  id: string;
  taken_at: string | null;
  location_name: string | null;
  description_short: string | null;
  description_full: string | null;
  tags: string[];
}

export interface DiaryChapter {
  chapter_num: number;
  title: string;
  date_from: string | null;
  date_to: string | null;
  locations: string[];
  photo_count: number;
  photos: DiaryPhoto[];
}

export interface DiaryPerson {
  id: string;
  name: string;
  photo_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

export interface PersonDiary {
  person: DiaryPerson;
  total_photos: number;
  total_chapters: number;
  chapters: DiaryChapter[];
}

export interface PersonStory {
  person_name: string;
  story: string;
  model: string;
  photo_count: number;
}

// Memory types
export interface MemoryAnswer {
  answer: string;
  conversation_id: string;
  context_items: number;
  model: string;
}

export interface MemoryReindexResult {
  message: string;
  indexed: Record<string, number>;
  total: number;
}

export interface MemoryDirective {
  id: string;
  directive: string;
  source: string;
  confidence?: number;
  is_active: boolean;
  created_at?: string;
}

export interface MemoryDirectivesResponse {
  directives: MemoryDirective[];
  count: number;
}
