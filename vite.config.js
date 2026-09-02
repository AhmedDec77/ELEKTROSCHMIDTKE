import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // TEMPORAIRE — désactivé pour obtenir un message d'erreur lisible sur
    // mobile (vrais noms de fonctions/variables au lieu de noms compressés
    // comme "Zi"). À remettre à true (ou supprimer cette ligne) une fois
    // le bug diagnostiqué et corrigé.
    minify: false,
  },
});
