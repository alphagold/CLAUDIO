import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { photosApi } from '../api/client';
import toast from 'react-hot-toast';
import { Upload, X, CheckCircle, Loader, Image as ImageIcon } from 'lucide-react';

interface PhotoUploadProps {
  onUploadComplete?: () => void;
}

interface FileWithPreview extends File {
  preview?: string;
  uploadStatus?: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export default function PhotoUpload({ onUploadComplete }: PhotoUploadProps) {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: photosApi.uploadPhoto,
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith('image/')
    );

    if (droppedFiles.length > 0) {
      addFiles(droppedFiles);
    } else {
      toast.error('Seleziona solo file immagine');
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    addFiles(selectedFiles);
    e.target.value = ''; // Reset input
  };

  const addFiles = (newFiles: File[]) => {
    const filesWithPreview: FileWithPreview[] = newFiles.map(file => {
      const fileWithPreview = file as FileWithPreview;
      fileWithPreview.preview = URL.createObjectURL(file);
      fileWithPreview.uploadStatus = 'pending';
      return fileWithPreview;
    });
    setFiles(prev => [...prev, ...filesWithPreview]);
  };

  const handleRemoveFile = (index: number) => {
    setFiles(prev => {
      const newFiles = [...prev];
      if (newFiles[index].preview) {
        URL.revokeObjectURL(newFiles[index].preview!);
      }
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    const uploadPromises = files
      .filter(f => f.uploadStatus === 'pending')
      .map(async (file, _originalIndex) => {
        const fileIndex = files.findIndex(f => f === file);

        try {
          // Update status to uploading
          setFiles(prev => {
            const newFiles = [...prev];
            newFiles[fileIndex].uploadStatus = 'uploading';
            return newFiles;
          });

          await uploadMutation.mutateAsync(file);

          // Update status to success
          setFiles(prev => {
            const newFiles = [...prev];
            newFiles[fileIndex].uploadStatus = 'success';
            return newFiles;
          });

          successCount++;
        } catch (error: any) {
          // Update status to error
          setFiles(prev => {
            const newFiles = [...prev];
            newFiles[fileIndex].uploadStatus = 'error';
            newFiles[fileIndex].error = error.response?.data?.detail || 'Errore durante l\'upload';
            return newFiles;
          });

          errorCount++;
        }
      });

    await Promise.all(uploadPromises);

    setIsUploading(false);

    // Show results
    if (successCount > 0) {
      toast.success(`${successCount} ${successCount === 1 ? 'foto caricata' : 'foto caricate'} con successo! 🎉`);
      queryClient.invalidateQueries({ queryKey: ['photos'] });

      // Remove successful uploads after delay
      setTimeout(() => {
        setFiles(prev => prev.filter(f => f.uploadStatus !== 'success'));
      }, 2000);

      onUploadComplete?.();
    }

    if (errorCount > 0) {
      toast.error(`${errorCount} ${errorCount === 1 ? 'foto fallita' : 'foto fallite'}`);
    }
  };

  const handleClear = () => {
    files.forEach(file => {
      if (file.preview) {
        URL.revokeObjectURL(file.preview);
      }
    });
    setFiles([]);
  };

  const pendingFiles = files.filter(f => f.uploadStatus === 'pending').length;
  const uploadingFiles = files.filter(f => f.uploadStatus === 'uploading').length;
  const successFiles = files.filter(f => f.uploadStatus === 'success').length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      {/* Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
          isDragging
            ? 'border-blue-500 bg-blue-50 scale-105'
            : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
        }`}
      >
        <div className="flex flex-col items-center">
          <div className={`p-4 rounded-full mb-4 transition-colors ${
            isDragging ? 'bg-blue-100' : 'bg-gray-100'
          }`}>
            <Upload className={`w-10 h-10 ${isDragging ? 'text-blue-600' : 'text-gray-400'}`} />
          </div>
          <p className="text-xl font-semibold text-gray-700 mb-2">
            Trascina le foto qui
          </p>
          <p className="text-sm text-gray-500 mb-6">
            oppure
          </p>
          <label className="cursor-pointer">
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isUploading}
            />
            <span className="px-8 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 active:scale-95 transition-all inline-block">
              Seleziona File
            </span>
          </label>
          <p className="text-xs text-gray-400 mt-4">
            Supporta JPG, PNG, HEIC, WebP (max 50MB)
          </p>
        </div>
      </div>

      {/* Selected Files List */}
      {files.length > 0 && (
        <div className="mt-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-semibold text-gray-900">
                {files.length} {files.length === 1 ? 'foto selezionata' : 'foto selezionate'}
              </h3>
              {uploadingFiles > 0 && (
                <p className="text-sm text-blue-600 mt-1">
                  Caricamento in corso: {uploadingFiles} di {files.length}
                </p>
              )}
              {successFiles > 0 && pendingFiles === 0 && uploadingFiles === 0 && (
                <p className="text-sm text-green-600 mt-1">
                  ✓ Tutte le foto caricate!
                </p>
              )}
            </div>
            {!isUploading && (
              <button
                onClick={handleClear}
                className="text-sm text-gray-600 hover:text-gray-900 font-medium"
              >
                Pulisci tutto
              </button>
            )}
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {files.map((file, index) => (
              <div
                key={index}
                className={`flex items-center justify-between p-4 rounded-xl transition-all ${
                  file.uploadStatus === 'success'
                    ? 'bg-green-50 border border-green-200'
                    : file.uploadStatus === 'error'
                    ? 'bg-red-50 border border-red-200'
                    : file.uploadStatus === 'uploading'
                    ? 'bg-blue-50 border border-blue-200'
                    : 'bg-gray-50 border border-gray-200'
                }`}
              >
                <div className="flex items-center space-x-4 flex-1 min-w-0">
                  {/* Thumbnail */}
                  <div className="relative flex-shrink-0">
                    {file.preview ? (
                      <img
                        src={file.preview}
                        alt={file.name}
                        className="w-16 h-16 object-cover rounded-lg"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-gray-200 rounded-lg flex items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-gray-400" />
                      </div>
                    )}
                    {file.uploadStatus === 'uploading' && (
                      <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                        <Loader className="w-6 h-6 text-white animate-spin" />
                      </div>
                    )}
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    {file.uploadStatus === 'error' && file.error && (
                      <p className="text-xs text-red-600 mt-1">{file.error}</p>
                    )}
                  </div>
                </div>

                {/* Status Icon */}
                <div className="flex items-center space-x-2 ml-4">
                  {file.uploadStatus === 'pending' && (
                    <button
                      onClick={() => handleRemoveFile(index)}
                      disabled={isUploading}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                  {file.uploadStatus === 'uploading' && (
                    <Loader className="w-6 h-6 text-blue-600 animate-spin" />
                  )}
                  {file.uploadStatus === 'success' && (
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  )}
                  {file.uploadStatus === 'error' && (
                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="p-2 text-red-400 hover:text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Upload Button */}
          <button
            onClick={handleUpload}
            disabled={isUploading || pendingFiles === 0}
            className="w-full mt-6 px-6 py-4 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center space-x-2"
          >
            {isUploading ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                <span>Caricamento in corso...</span>
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                <span>
                  Carica {pendingFiles} {pendingFiles === 1 ? 'Foto' : 'Foto'}
                </span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
