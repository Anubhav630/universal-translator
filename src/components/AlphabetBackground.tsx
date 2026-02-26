// Alphabet background component
import { useEffect } from 'react';

export function AlphabetBackground() {
  useEffect(() => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZαβγδεζηθあいうえおかきくけこ中文字한글字母表אבגדהابتثج';
    const container = document.getElementById('alphabet-bg');
    if (!container) return;

    // Create 50 random floating letters
    for (let i = 0; i < 50; i++) {
      const letter = document.createElement('div');
      letter.className = 'floating-letter';
      letter.textContent = letters[Math.floor(Math.random() * letters.length)];
      
      // Random positioning
      letter.style.left = `${Math.random() * 100}%`;
      letter.style.top = `${Math.random() * 100}%`;
      
      // Random size
      const size = 80 + Math.random() * 200;
      letter.style.fontSize = `${size}px`;
      
      // Random opacity
      letter.style.opacity = `${0.02 + Math.random() * 0.03}`;
      
      // Random animation duration
      const duration = 40 + Math.random() * 80;
      letter.style.animationDuration = `${duration}s`;
      
      // Random animation delay
      letter.style.animationDelay = `${Math.random() * -30}s`;
      
      // Random rotation
      letter.style.transform = `rotate(${Math.random() * 360}deg)`;
      
      container.appendChild(letter);
    }

    return () => {
      if (container) {
        container.innerHTML = '';
      }
    };
  }, []);

  return <div id="alphabet-bg" className="alphabet-background" />;
}
