// WAVE-1-STUB — Wave 1 Agent B replaces this with the real Sidebar.
// Consumers (Chats page, Chat page) import this; the stub keeps their builds green.

export interface SidebarProps {
  activeChatId: string | null;
  onOpenSettings: () => void;
}

export function Sidebar(_props: SidebarProps) {
  return <aside className="sidebar" data-stub="sidebar" />;
}

export default Sidebar;
