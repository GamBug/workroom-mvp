import React from 'react';
import { useWorkroomStore } from './store/useWorkroomStore';
import AuthModalOrPage from './components/auth/AuthModalOrPage';
import HomeProjects from './pages/HomeProjects';
import ProjectWorkspace from './pages/ProjectWorkspace';

export default function App() {
  const { currentUser, currentProjectId } = useWorkroomStore();

  // 1. If not logged in, show Auth Screen
  if (!currentUser) {
    return <AuthModalOrPage />;
  }

  // 2. If logged in and in a project, show Project Workspace
  if (currentProjectId) {
    return <ProjectWorkspace />;
  }

  // 3. Otherwise show Home Projects list
  return <HomeProjects />;
}
