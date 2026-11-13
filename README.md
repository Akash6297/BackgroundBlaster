# BackgroundBlaster

BackgroundBlaster is a website that allows users to easily remove the background from their photos with just one click. It provides a simple and user-friendly interface for uploading images and obtaining the output image without the background.

## Live Website

Check out the live website [here](http://akash-mandal.me/BackgroundBlaster).

## Repository

The code for BackgroundBlaster can be found in this [GitHub repository](https://github.com/Akash6297/BackgroundBlaster).

## Features

- **One-step background removal**: upload, drop or paste (Ctrl+V) a photo and the background is removed automatically
- **Backgrounds**: transparent, preset or custom colours, a blurred version of the original, or your own image
- **Sizes**: original, trim to subject, passport/visa (US/India 2×2 in, UK/EU 35×45 mm, Canada, China) at 300 DPI with automatic head positioning, plus social/web presets
- **Export**: PNG, JPG, WEBP, BMP (and AVIF where the browser supports it), with quality and 0.5×/1×/2× resolution control; print DPI is embedded for passport sizes
- **4×6 in print sheet** with several copies and cut guides
- Copy to clipboard, light/dark theme, works on mobile
- Visitors can add their own remove.bg API key under **API settings** (stored only in their browser)
- The contact form opens the visitor's email app with the message ready to send

## How background removal works

The app checks the remove.bg account balance first. If credits are available it requests a full-resolution cutout. Otherwise it uses the free `preview` size and applies that mask to the full-resolution original in the browser, so the subject stays sharp. Editing and exporting happen entirely in the browser (Fabric.js).

> **Note:** an API key in front-end code is public. For production, move the remove.bg call behind a small server or serverless function.

## Technologies Used

- HTML, CSS, JavaScript (no build step)
- Fabric.js
- Font Awesome
- remove.bg API

## Usage

To use BackgroundBlaster locally, follow these steps:

1. Clone this repository: `git clone https://github.com/Akash6297/BackgroundBlaster.git`
2. Open the index.html file in a web browser.

## Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request.

## License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).

## Contact

If you have any questions or feedback, feel free to contact the project owner:

- Name: Akash Mandal
- Email: akashmandal6297@gmail.com
- Twitter: [@akashma36499324](https://twitter.com/akashma36499324)

Thank you for visiting BackgroundBlaster!
