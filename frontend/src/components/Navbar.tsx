import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Brain, Album, Map, LogOut, User, Shield, Settings } from 'lucide-react';

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 shadow-sm z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/gallery" className="flex items-center space-x-3 group">
            <div className="relative">
              <div className="absolute -inset-2 bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-500 rounded-xl blur-md opacity-75 group-hover:opacity-100 transition-opacity"></div>
              <div className="relative bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-500 p-2 rounded-xl shadow-lg">
                <Brain className="w-6 h-6 text-white" />
              </div>
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-500 bg-clip-text text-transparent">
              Done
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center space-x-1">
            <Link
              to="/gallery"
              className={`relative flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                isActive('/gallery')
                  ? 'bg-gradient-to-r from-blue-50 to-blue-100 text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Images className="w-5 h-5" />
              <span className="font-medium">Gallery</span>
              {isActive('/gallery') && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-600 to-blue-400 rounded-full"></div>
              )}
            </Link>

            <Link
              to="/albums"
              className={`relative flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                isActive('/albums')
                  ? 'bg-gradient-to-r from-blue-50 to-blue-100 text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Album className="w-5 h-5" />
              <span className="font-medium">Albums</span>
              {isActive('/albums') && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-600 to-blue-400 rounded-full"></div>
              )}
            </Link>

            <Link
              to="/map"
              className={`relative flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                isActive('/map')
                  ? 'bg-gradient-to-r from-blue-50 to-blue-100 text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Map className="w-5 h-5" />
              <span className="font-medium">Mappa</span>
              {isActive('/map') && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-600 to-blue-400 rounded-full"></div>
              )}
            </Link>

            <Link
              to="/settings"
              className={`relative flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                isActive('/settings')
                  ? 'bg-gradient-to-r from-green-50 to-green-100 text-green-600 shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Settings className="w-5 h-5" />
              <span className="font-medium">Impostazioni</span>
              {isActive('/settings') && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-green-600 to-green-400 rounded-full"></div>
              )}
            </Link>

            {/* Admin Link - Only for admins */}
            {user?.is_admin && (
              <Link
                to="/admin"
                className={`relative flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                  isActive('/admin') || location.pathname.startsWith('/admin')
                    ? 'bg-gradient-to-r from-purple-50 to-purple-100 text-purple-600 shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Shield className="w-5 h-5" />
                <span className="font-medium">Admin</span>
                {(isActive('/admin') || location.pathname.startsWith('/admin')) && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-600 to-purple-400 rounded-full"></div>
                )}
              </Link>
            )}
          </div>

          {/* User Menu */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg border border-gray-200/50">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center shadow-sm">
                <User className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm font-medium text-gray-700">{user?.full_name || user?.email}</span>
            </div>
            <button
              onClick={handleLogout}
              className="group flex items-center space-x-2 px-4 py-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
            >
              <LogOut className="w-5 h-5 group-hover:rotate-12 transition-transform duration-200" />
              <span className="font-medium">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
