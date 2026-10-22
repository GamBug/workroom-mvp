import React, { useState } from 'react';
import { useWorkroomStore } from '../../store/useWorkroomStore';
import { FolderKanban, LogIn, UserPlus, Sparkles, Check, AlertCircle } from 'lucide-react';

const AVATAR_COLORS = [
  '#3b82f6', // Blue
  '#ec4899', // Pink
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#06b6d4', // Cyan
  '#8b5cf6', // Violet
  '#ef4444', // Red
  '#64748b', // Slate
];

const DEMO_USERS = [
  { username: 'admin', name: 'Admin', role: 'Full Access', color: '#3b82f6' },
  { username: 'alice', name: 'Alice Nguyen', role: 'Product & Design', color: '#ec4899' },
  { username: 'bob', name: 'Bob Tran', role: 'Engineering', color: '#10b981' },
];

export default function AuthModalOrPage() {
  const { login, register, isLoading, error } = useWorkroomStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Form states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (mode === 'login') {
      if (!username.trim() || !password) {
        setLocalError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
        return;
      }
      const success = await login(username.trim(), password);
      if (!success) {
        setLocalError('Tên đăng nhập hoặc mật khẩu không chính xác.');
      }
    } else {
      if (!username.trim() || !displayName.trim() || !password) {
        setLocalError('Vui lòng điền đầy đủ tất cả các trường.');
        return;
      }
      const success = await register({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        avatarColor,
      });
      if (!success) {
        setLocalError('Tên đăng nhập đã tồn tại hoặc xảy ra lỗi.');
      }
    }
  };

  const handleQuickLogin = async (demoUsername: string) => {
    setLocalError(null);
    setUsername(demoUsername);
    setPassword('123');
    await login(demoUsername, '123');
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-zinc-200/90 rounded-2xl p-8 shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
        {/* Brand Header */}
        <div className="text-center mb-7">
          <div className="inline-flex p-2.5 rounded-xl bg-zinc-900 text-white mb-3.5 shadow-sm">
            <FolderKanban className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-zinc-900 tracking-tight">Mini Workroom</h1>
          <p className="text-zinc-500 text-xs mt-1">Không gian làm việc & Quản lý Dự án đa năng</p>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 p-1 bg-zinc-100 rounded-xl mb-5 border border-zinc-200/70">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setLocalError(null);
            }}
            className={`py-1.5 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 ${
              mode === 'login'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setLocalError(null);
            }}
            className={`py-1.5 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 ${
              mode === 'register'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Đăng ký
          </button>
        </div>

        {/* Error Alert */}
        {(localError || error) && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-500" />
            <span>{localError || error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">
              Tên đăng nhập (Username)
            </label>
            <input
              type="text"
              required
              placeholder="VD: admin, alice..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Tên hiển thị (Display Name)
              </label>
              <input
                type="text"
                required
                placeholder="VD: Nguyễn Văn A"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">Mật khẩu</label>
            <input
              type="password"
              required
              placeholder="Nhập mật khẩu (VD: 123)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Màu đại diện</label>
              <div className="flex items-center gap-2 flex-wrap">
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAvatarColor(c)}
                    className="w-6 h-6 rounded-full flex items-center justify-center transition transform hover:scale-110 relative border border-black/10"
                    style={{ backgroundColor: c }}
                  >
                    {avatarColor === c && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white font-medium rounded-lg text-xs transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {isLoading ? (
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : mode === 'login' ? (
              <>
                <LogIn className="w-3.5 h-3.5" />
                Đăng nhập
              </>
            ) : (
              <>
                <UserPlus className="w-3.5 h-3.5" />
                Tạo tài khoản
              </>
            )}
          </button>
        </form>

        {/* Demo Users Quick Login */}
        <div className="mt-6 pt-5 border-t border-zinc-100">
          <div className="flex items-center justify-center gap-1.5 text-xs text-zinc-500 font-medium mb-2.5">
            <Sparkles className="w-3 h-3 text-amber-500" />
            <span>Đăng nhập nhanh (Demo Users)</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {DEMO_USERS.map((demo) => (
              <button
                key={demo.username}
                type="button"
                onClick={() => handleQuickLogin(demo.username)}
                disabled={isLoading}
                className="p-2 rounded-xl bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/70 text-left transition group flex flex-col items-center text-center cursor-pointer"
              >
                <div
                  className="w-6 h-6 rounded-full text-white font-bold text-[10px] flex items-center justify-center mb-1 shadow-xs"
                  style={{ backgroundColor: demo.color }}
                >
                  {demo.username[0].toUpperCase()}
                </div>
                <div className="text-xs font-semibold text-zinc-900 group-hover:text-zinc-700">
                  {demo.username}
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5 line-clamp-1">{demo.role}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
