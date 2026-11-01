import ReactDOM from 'react-dom/client';
import App from './App';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-500.css';
import '@fontsource/lora/latin-600.css';
import '@fontsource/lora/latin-400-italic.css';
import './styles.css';

// Fonts load lazily on first use. Fetch the lyric faces now so the first lyric doesn't lay out in a fallback
// font and re-wrap (changing its height) halfway through its transition.
void Promise.all(['400 1em Lora', '500 1em Lora', '600 1em Lora', 'italic 400 1em Lora', '400 1em "DM Sans"', '500 1em "DM Sans"'].map((face) => document.fonts.load(face))).catch(() => undefined);

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
