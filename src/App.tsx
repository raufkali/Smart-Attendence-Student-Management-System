import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  FileSpreadsheet,
  GitMerge,
  UserCheck,
  CalendarDays,
  ClipboardCheck,
  Wallet,
  AlertOctagon,
  GraduationCap,
  Smartphone,
  ShieldAlert,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { clearAuthToken } from './api/client';
import { AuthGate, type AuthUser } from './components/AuthGate';
import { DashboardView } from './components/DashboardView';
import { SetupWizardView } from './components/SetupWizardView';
import { StudentsView } from './components/StudentsView';
import { ExcelImportView } from './components/ExcelImportView';
import { DuplicatesView } from './components/DuplicatesView';
import { TeachersSubjectsView } from './components/TeachersSubjectsView';
import { TimetableView } from './components/TimetableView';
import { AttendanceView } from './components/AttendanceView';
import { FinanceView } from './components/FinanceView';
import { FinesDefaultersView } from './components/FinesDefaultersView';
import { PromotionWizardView } from './components/PromotionWizardView';
import { DeviceSyncView } from './components/DeviceSyncView';
import { AuditRollbackView } from './components/AuditRollbackView';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Overview & Tasks', icon: LayoutDashboard },
  { id: 'students', label: 'Students & Admissions', icon: Users },
  { id: 'excel', label: 'Excel & Bulk Photos', icon: FileSpreadsheet },
  { id: 'duplicates', label: 'Duplicate Center', icon: GitMerge },
  { id: 'teachers', label: 'Faculty & Subjects', icon: UserCheck },
  { id: 'timetable', label: 'Timetable & Cloning', icon: CalendarDays },
  { id: 'attendance', label: 'Attendance Console', icon: ClipboardCheck },
  { id: 'finance', label: 'Fees & Receipts', icon: Wallet },
  { id: 'defaulters', label: 'Fines & Defaulters', icon: AlertOctagon },
  { id: 'promotions', label: 'Promotion Wizard', icon: GraduationCap },
  { id: 'sync', label: 'Android Device Sync', icon: Smartphone },
  { id: 'audit', label: 'Audit & Rollback', icon: ShieldAlert },
  { id: 'setup', label: 'Institution Setup', icon: Settings },
];

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!user) {
    return <AuthGate onAuthenticated={setUser} />;
  }

  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab) || NAV_ITEMS[0];

  const handleLogout = () => {
    clearAuthToken();
    setUser(null);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView onNavigate={setActiveTab} />;
      case 'students':
        return <StudentsView />;
      case 'excel':
        return <ExcelImportView />;
      case 'duplicates':
        return <DuplicatesView />;
      case 'teachers':
        return <TeachersSubjectsView />;
      case 'timetable':
        return <TimetableView />;
      case 'attendance':
        return <AttendanceView />;
      case 'finance':
        return <FinanceView />;
      case 'defaulters':
        return <FinesDefaultersView />;
      case 'promotions':
        return <PromotionWizardView />;
      case 'sync':
        return <DeviceSyncView />;
      case 'audit':
        return <AuditRollbackView />;
      case 'setup':
        return <SetupWizardView />;
      default:
        return <DashboardView onNavigate={setActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar Navigation (248px desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-62 bg-white border-r border-slate-200 flex flex-col transition-transform lg:static lg:translate-x-0 no-print ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/src/assets/images/institution_crest_1795676738629.jpg"
              alt="ScholarGrid crest"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded object-cover border border-slate-200 shrink-0"
            />
            <span className="text-sm font-bold text-slate-900 truncate whitespace-nowrap">ScholarGrid</span>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden text-slate-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5" aria-label="Primary Sidebar">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors text-left whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-50 text-blue-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-800' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={user.avatarUrl}
              alt={user.fullName}
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">{user.fullName}</div>
              <div className="text-[11px] text-slate-500 truncate">{user.username}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            aria-label="Sign out"
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 text-slate-600 border border-slate-200 rounded-lg"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-sm font-semibold text-slate-900 whitespace-nowrap truncate">
              Administration · {activeNav.label}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-600">
            <button onClick={() => setActiveTab('students')} className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Students
            </button>
            <button onClick={() => setActiveTab('timetable')} className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Timetable
            </button>
            <button onClick={() => setActiveTab('attendance')} className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Attendance
            </button>
            <button onClick={() => setActiveTab('finance')} className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Finance
            </button>
          </div>

          <button
            onClick={() => setActiveTab('sync')}
            className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
          >
            Device Sync
          </button>
        </header>

        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">{renderContent()}</main>
      </div>
    </div>
  );
}
