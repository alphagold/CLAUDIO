import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { photosApi } from '../api/client';
import { Upload, X, CheckCircle, AlertCircle, Loader } from 'lucide-react';

interface PhotoUploadProps {
  onUploadComplete?: () => void;
}

export default function PhotoUpload({ onUploadComplete }: PhotoUploadProps) {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, 'pending' | 'uploading' | 'success' | 'error'>>({});

  const uploadMutation = useMutation({
    mutationFn: photosApi.uploadPhoto,
    onSuccess: (_, file) => {
      setUploadProgress(prev => ({ ...prev, [file.name]: 'success' }));
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      onUploadComplete?.();
    },
    onError: (_, file) => {
      setUploadProgress(prev => ({ ...prev, [file.name]: 'error' }));
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith('image/')
    );

    if (files.length > 0) {
      setSelectedFiles(prev => [...prev, ...files]);
      files.forEach(file => {
        setUploadProgress(prev => ({ ...prev, [file.name]: 'pending' }));
      });
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(prev => [...prev, ...files]);
    files.forEach(file => {
      setUploadProgress(prev => ({ ...prev, [file.name]: 'pending' }));
    });
  };

  const handleUpload = async () => {
    for (const file of selectedFiles) {
      if (uploadProgress[file.name] === 'pending') {
        setUploadProgress(prev => ({ ...prev, [file.name]: 'uploading' }));
        await uploadMutation.mutateAsync(file);
      }
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setSelectedFiles(prev => prev.filter(f => f.name !== fileName));
    setUploadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[fileName];
      return newProgress;
    });
  };

  const handleClear = () => {
    setSelectedFiles([]);
    setUploadProgress({});
  };

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
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
        <p className="text-lg font-medium text-gray-700 mb-2">
          Trascina le foto qui
        </p>
        <p className="text-sm text-gray-500 mb-4">
          oppure
        </p>
        <label className="inline-block">
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <span className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 cursor-pointer inline-block transition-colors">
            Seleziona File
          </span>
        </label>
        <p className="text-xs text-gray-400 mt-4">
          Supporta JPG, PNG, HEIC, WebP
        </p>
      </div>

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <div className="mt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-gray-900">
              {selectedFiles.length} {selectedFiles.length === 1 ? 'foto selezionata' : 'foto selezionate'}
            </h3>
            <button
              onClick={handleClear}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Pulisci tutto
            </button>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {selectedFiles.map((file) => {
              const status = uploadProgress[file.name];
              return (
                <div
                  key={file.name}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      className="w-12 h-12 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 ml-4">
                    {status === 'pending' && (
                      <button
                        onClick={() => handleRemoveFile(file.name)}
                        className="p-1 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    )}
                    {status === 'uploading' && (
                      <Loader className="w-5 h-5 text-blue-600 animate-spin" />
                    )}
                    {status === 'success' && (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    )}
                    {status === 'error' && (
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Upload Button */}
          <button
            onClick={handleUpload}
            disabled={uploadMutation.isPending || selectedFiles.every(f => uploadProgress[f.name] !== 'pending')}
            className="w-full mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {uploadMutation.isPending ? 'Caricamento...' : 'Carica Foto'}
          </button>
        </div>
      )}
    </div>
  );
}
