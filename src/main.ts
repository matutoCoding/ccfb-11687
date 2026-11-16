import './style.css';
import { renderApp } from './shell';

document.querySelector('#app')?.replaceWith(renderApp());
