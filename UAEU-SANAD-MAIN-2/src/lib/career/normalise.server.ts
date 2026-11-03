/** Shared skill-term normalisation used by career matching and ATS scoring. */
const SYNONYMS: Record<string, string> = {
  ml: "machine learning",
  "deep learning": "deep learning",
  ai: "artificial intelligence",
  js: "javascript",
  ts: "typescript",
  "power-bi": "power bi",
  powerbi: "power bi",
  postgresql: "postgres",
  "node js": "node.js",
  nodejs: "node.js",
  "sci-kit learn": "scikit-learn",
  sklearn: "scikit-learn",
  "ms excel": "excel",
  "microsoft excel": "excel",
  nlp: "natural language processing",
  cv: "computer vision",
  "c i / c d": "ci/cd",
  cicd: "ci/cd",
  k8s: "kubernetes",
  "amazon web services": "aws",
};

export function norm(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9+#./ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return SYNONYMS[s] ?? s;
}
