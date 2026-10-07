import { analyzeText } from './analysis.js';
self.onmessage = async ({ data }) => {
  try {
    const result = await analyzeText(data.text, (progress) =>
      self.postMessage({ type: 'progress', ...progress }),
    );
    self.postMessage({ type: 'done', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
