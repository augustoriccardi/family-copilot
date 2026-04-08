"use client";
import React, { useRef, useState, useEffect } from "react";
import { PanelLeftClose, LogOut, ChevronDown } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

interface HeaderProps {
  toggleSidebar: () => void;
}

export const Header = ({ toggleSidebar }: HeaderProps) => {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const user = session?.user;
  const displayName = user?.name ?? user?.email ?? "Usuario";
  const initials = getInitials(displayName);

  return (
    <header className="sticky top-0 z-10 flex items-center px-4 py-3">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center">
          <button
            onClick={toggleSidebar}
            className="mr-4 cursor-pointer rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Toggle navigation"
          >
            <PanelLeftClose size={25} />
          </button>
          <Link href="/" className="flex items-center">
            <span className="hidden text-xl font-semibold text-gray-800 sm:block">
              Family Copilot
            </span>
          </Link>
        </div>

        {/* User menu */}
        {user && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-gray-100"
              aria-label="User menu"
            >
              {user.image ? (
                <Image
                  src={user.image}
                  alt={displayName}
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white">
                  {initials}
                </span>
              )}
              <span className="hidden max-w-30 truncate text-sm font-medium text-gray-700 sm:block">
                {displayName}
              </span>
              <ChevronDown size={14} className="text-gray-400" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-1 w-44 rounded-lg border border-gray-100 bg-white py-1 shadow-lg">
                <div className="border-b border-gray-100 px-3 py-2">
                  <p className="truncate text-xs font-medium text-gray-800">{displayName}</p>
                  {user.email && <p className="truncate text-xs text-gray-400">{user.email}</p>}
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                >
                  <LogOut size={14} />
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
