import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--fonte-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--fonte-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Adverdad", template: "%s · Adverdad" },
  description: "Saiba quais anúncios trazem venda, não só conversa, e o que fazer a seguir.",
  robots: { index: false, follow: false },
};

// Tema: o script roda antes da primeira pintura e aplica o salvo (ou o do sistema), sem piscar.
const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem("tema");if(t!=="claro"&&t!=="escuro"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"escuro":"claro"}document.documentElement.setAttribute("data-theme",t==="escuro"?"dark":"light")}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" data-theme="light" suppressHydrationWarning className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
