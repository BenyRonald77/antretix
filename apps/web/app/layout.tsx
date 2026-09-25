import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

// Archivo: sans bernuansa poster konser dengan sumbu lebar (width), angka tebal untuk nomor antrean.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", axes: ["wdth"] });

export const metadata: Metadata = {
  title: "AntreTix",
  description: "Beli tiket konser lewat ruang tunggu virtual yang adil.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={archivo.variable} suppressHydrationWarning>
      <head>
        {/* Terapkan tema yang dipilih pengguna sebelum paint pertama, agar tidak berkedip. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("antretix.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen">
        <AuthProvider>
          <SiteHeader />
          <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
