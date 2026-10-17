import {useEffect,useState} from 'react';
export default function ThemeToggle({className=''}){
 const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('campusconnect.theme')||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{return 'light';}});
 useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('campusconnect.theme',theme);}catch{/* Optional preference storage. */}},[theme]);
 return <button type="button" className={`theme-toggle ${className}`} onClick={()=>setTheme(t=>t==='dark'?'light':'dark')} aria-label={`Switch to ${theme==='dark'?'light':'dark'} theme`} title={`Switch to ${theme==='dark'?'light':'dark'} theme`}>{theme==='dark'?'☀':'☾'}<span>{theme==='dark'?'Light':'Dark'}</span></button>;
}
