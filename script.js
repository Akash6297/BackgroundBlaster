let imageURL;

function handleUpload() {
  const fileInput = document.getElementById('filepicker');
  const image = fileInput.files[0];

  const apiKey = "6A2FddUNck3phNAi34P2tGqc";
  const fromData = new FormData();
  fromData.append("image_file", image);
  fromData.append('size', 'auto');

  fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
    },
    body: fromData
  })
  .then(function(response) {
    return response.blob();
  })
  .then(function(blob) {
    const url = URL.createObjectURL(blob);
    imageURL = url;
    const outputImg = document.getElementById('outputImg');
    outputImg.src = url;
  })
  .catch(function(error) {
    console.log(error);
  });
}

function downloadFile() {
  var anchorElement = document.createElement('a');
  anchorElement.href = imageURL;
  anchorElement.download = 'no-bg.png';
  document.body.appendChild(anchorElement);

  anchorElement.click();

  document.body.removeChild(anchorElement);
}


// contact from js 

function submitForm(event) {
    event.preventDefault(); // Prevent form submission
  
    // Get form values
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const message = document.getElementById('message').value;
  
    // You can perform validation or further processing of the form data here
  
    // Display a success message
    alert(`Thank you, ${name}! Your message has been sent.`);
  
    // Reset the form
    document.getElementById('contactForm').reset();
    document.getElementById('submitBtn').addEventListener('click', submitForm);
  }
  

  function toggleMenu() {
    var menu = document.querySelector('.menu');
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
  }

  // Add this JavaScript code
document.addEventListener("DOMContentLoaded", function() {
  var popupContainer = document.querySelector(".popup-container");
  var popupCloseBtn = document.querySelector(".popup-close-btn");

  // Close the popup when the close button is clicked
  popupCloseBtn.addEventListener("click", function() {
    closePopup();
  });

  // Close the popup when clicking outside the popup container
  popupContainer.addEventListener("click", function(e) {
    if (e.target === popupContainer) {
      closePopup();
    }
  });

  // Show the popup when the page is loaded
  showPopup();

  function showPopup() {
    popupContainer.style.display = "flex";
  }

  function closePopup() {
    popupContainer.style.display = "none";
  }
});
