import { createRoot } from 'react-dom/client';
import App from './App';
import Teach from './Teach';
import './styles.css';

const page = location.pathname.startsWith('/teach') ? <Teach /> : <App />;
createRoot(document.getElementById('root')!).render(page);
