import { memo } from 'react';

interface PhotoSkeletonProps {
  viewMode: 'grid-small' | 'grid-large' | 'list' | 'details';
}

function PhotoSkeleton({ viewMode }: PhotoSkeletonProps) {
  if (viewMode === 'list') {
    return (
      <div className="bg-white rounded-lg overflow-hidden shadow-sm border border-gray-200 flex items-center animate-pulse">
        <div className="w-32 h-32 flex-shrink-0 bg-gradient-to-br from-gray-200 to-gray-300"></div>
        <div className="flex-1 p-4 space-y-3">
          <div className="h-4 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded w-3/4"></div>
          <div className="h-3 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded w-full"></div>
          <div className="h-3 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded w-5/6"></div>
          <div className="flex space-x-2 mt-2">
            <div className="h-5 w-16 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded-full"></div>
            <div className="h-5 w-20 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded-full"></div>
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'details') {
    return (
      <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-200 animate-pulse">
        <div className="aspect-video bg-gradient-to-br from-gray-200 via-gray-300 to-gray-200"></div>
        <div className="p-4 space-y-3">
          <div className="h-5 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded w-3/4"></div>
          <div className="h-3 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded w-full"></div>
          <div className="h-3 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded w-5/6"></div>
          <div className="flex flex-wrap gap-2 mt-3">
            <div className="h-6 w-16 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded-full"></div>
            <div className="h-6 w-20 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded-full"></div>
            <div className="h-6 w-14 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded-full"></div>
          </div>
        </div>
      </div>
    );
  }

  // Grid view (small or large)
  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-200 animate-pulse">
      <div className="aspect-square bg-gradient-to-br from-gray-200 via-gray-300 to-gray-200"></div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
    </div>
  );
}

// Wrap with memo to prevent unnecessary re-renders
export default memo(PhotoSkeleton);
