  const openModalButton = document.getElementById('openModal');
  const closeModalButton = document.getElementById('closeModal');
  const modal = document.getElementById('myModal');
  const overlay = document.querySelector('.modal__overlay');
  const map = document.getElementById('map');

  if (openModalButton && closeModalButton && modal && overlay) {
    openModalButton.addEventListener('click', () => {
      modal.classList.add('modal--active');
      document.body.style.overflow = 'hidden';
      map.style.filter =  'blur(6px)';
    });
      closeModalButton.addEventListener('click', () => {
      modal.classList.remove('modal--active');
      document.body.style.overflow = '';
      map.style.filter =  '';
    });
      overlay.addEventListener('click', () => {
      modal.classList.remove('modal--active');
      document.body.style.overflow = '';  
      map.style.filter =  '';
    });
  }

  