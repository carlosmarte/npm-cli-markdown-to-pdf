const fs = require("fs");
const path = require("path");
const markdownIt = require("markdown-it");
const puppeteer = require("puppeteer");
const { program } = require("commander");
const hljs = require("highlight.js");
const slugify = require("slugify");

// Initialize markdown-it with plugins
const md = new markdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return (
          '<pre class="hljs"><code>' +
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
          "</code></pre>"
        );
      } catch (__) {}
    }
    return (
      '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + "</code></pre>"
    );
  },
});

// Configuration for image path remapping - will be populated based on CLI options
const imagePathConfig = {
  // Enable path remapping
  enableRemapping: true,

  // Remap specific paths or patterns
  pathMappings: [
    {
      from: /\/assets\//g,
      to: "/_assets/",
    },
    // Add more mappings as needed
  ],

  // Whether to process external URLs (starting with http:// or https://)
  handleExternalUrls: true,
};

// Remap image path according to configuration
function remapImagePath(imagePath) {
  // Don't process external URLs as file paths
  if (imagePath.match(/^https?:\/\//i)) {
    return {
      path: imagePath,
      isExternal: true,
    };
  }

  let remappedPath = imagePath;

  // Apply path mappings if enabled
  if (imagePathConfig.enableRemapping) {
    for (const mapping of imagePathConfig.pathMappings) {
      remappedPath = remappedPath.replace(mapping.from, mapping.to);
    }
  }

  return {
    path: remappedPath,
    isExternal: false,
  };
}

// Helper function to extract headings for TOC
function extractHeadings(content) {
  const headings = [];
  const lines = content.split("\n");

  for (let line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      // Generate a more reliable ID by removing problematic characters
      const id = slugify(text, {
        lower: true,
        strict: true,
        replacement: "-",
      });

      headings.push({ level, text, id });
    }
  }

  return headings;
}

// Generate table of contents HTML
function generateTOC(headings) {
  let toc =
    '<div class="toc-container">\n<h2>Table of Contents</h2>\n<ul class="toc">\n';

  headings.forEach((heading) => {
    const indent = "  ".repeat(heading.level - 1);
    // Sanitize heading text for display in TOC (keeps the formatting in the actual headings)
    const displayText = heading.text.replace(/\*\*/g, ""); // Remove markdown bold syntax
    toc += `${indent}<li class="toc-level-${heading.level}"><a href="#${heading.id}">${displayText}</a></li>\n`;
  });

  toc += '</ul>\n</div>\n<div class="page-break"></div>\n';
  return toc;
}

// Add IDs to headings for TOC links
function addHeadingIds(html, headings) {
  let processedHtml = html;

  headings.forEach((heading) => {
    // Use DOM parsing instead of regex for more reliable heading replacement
    const tagName = `h${heading.level}`;
    const pattern = `<${tagName}>(.*?)</${tagName}>`;
    const regex = new RegExp(pattern, "g");

    let match;
    let replaced = false;

    while ((match = regex.exec(processedHtml)) !== null && !replaced) {
      // Check if this heading text matches our target
      if (match[1].trim() === heading.text.trim()) {
        const original = match[0];
        const replacement = `<${tagName} id="${heading.id}">${match[1]}</${tagName}>`;
        processedHtml = processedHtml.replace(original, replacement);
        replaced = true;
      }
    }
  });

  return processedHtml;
}

// Extract image paths from markdown content
function extractImagePaths(content) {
  // Updated regex to handle image paths that may include title attributes
  const regex = /!\[.*?\]\((.*?)(?:\s+".*?")?\)/g;
  const imagePaths = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add the image path to our array, excluding any title attribute
    imagePaths.push(match[1].trim());
  }

  return imagePaths;
}

// Copy images to output directory for HTML
function copyImages(sourceFilePath, imagePaths, outputDir) {
  const sourceDir = path.dirname(sourceFilePath);
  const imagesOutputDir = path.join(outputDir, "images");

  if (!fs.existsSync(imagesOutputDir)) {
    fs.mkdirSync(imagesOutputDir, { recursive: true });
  }

  return imagePaths.map((imagePath) => {
    // Skip external URLs
    if (imagePath.match(/^https?:\/\//i)) {
      console.log(`External URL detected, keeping as-is: ${imagePath}`);
      return imagePath; // Keep external URLs as they are
    }

    // Apply path remapping
    const remappedImage = remapImagePath(imagePath);

    // If it's an external URL after remapping, return as is
    if (remappedImage.isExternal) {
      return remappedImage.path;
    }

    // Use the remapped path for resolution
    const pathToResolve = remappedImage.path;

    // Resolve image path relative to markdown file
    const resolvedImagePath = path.resolve(sourceDir, pathToResolve);

    if (fs.existsSync(resolvedImagePath)) {
      // Preserve subdirectory structure within the images folder
      const relativeDir = path.dirname(pathToResolve).replace(/^\.\//, "");
      const nestedOutputDir = path.join(imagesOutputDir, relativeDir);

      // Create nested output directory if it doesn't exist
      if (relativeDir !== "." && !fs.existsSync(nestedOutputDir)) {
        fs.mkdirSync(nestedOutputDir, { recursive: true });
      }

      const fileName = path.basename(resolvedImagePath);
      const finalOutputDir =
        relativeDir === "." ? imagesOutputDir : nestedOutputDir;
      const outputPath = path.join(finalOutputDir, fileName);

      // Copy image to output directory
      fs.copyFileSync(resolvedImagePath, outputPath);

      // Return relative path for HTML reference
      return relativeDir === "."
        ? `images/${fileName}`
        : `images/${relativeDir}/${fileName}`;
    }

    console.log(`Warning: Image not found: ${resolvedImagePath}`);
    // If image doesn't exist, return original path
    return imagePath;
  });
}

// Process image paths in HTML content for HTML output
function processHtmlImagesForHtml(html, originalPaths, newPaths) {
  let processedHtml = html;

  for (let i = 0; i < originalPaths.length; i++) {
    // Escape special characters in the original path for regex
    const escapedOrigPath = originalPaths[i].replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
    const regex = new RegExp(`src="${escapedOrigPath}"`, "g");
    processedHtml = processedHtml.replace(regex, `src="${newPaths[i]}"`);
  }

  return processedHtml;
}

// Convert images to base64 for PDF embedding
function convertImagesToBase64(sourceFilePath, html) {
  const sourceDir = path.dirname(sourceFilePath);
  const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
  let processedHtml = html;
  let match;
  let imgTags = [];

  // First collect all img tags to avoid regex iterator issues with replacements
  while ((match = imgRegex.exec(html)) !== null) {
    imgTags.push({
      fullTag: match[0],
      src: match[1],
    });
  }

  // Now process each image
  for (const img of imgTags) {
    const imgTag = img.fullTag;
    const imgSrc = img.src;

    // Handle external URLs differently
    if (imgSrc.match(/^https?:\/\//i)) {
      console.log(`External URL image detected: ${imgSrc}`);
      // Keep external URLs as they are
      continue;
    }

    // Apply path remapping
    const remappedImage = remapImagePath(imgSrc);

    // If it's an external URL after remapping, skip embedding
    if (remappedImage.isExternal) {
      continue;
    }

    // Use the remapped path for resolution
    const pathToResolve = remappedImage.path;

    // Resolve image path relative to markdown file
    const resolvedImagePath = path.resolve(sourceDir, pathToResolve);

    if (fs.existsSync(resolvedImagePath)) {
      // Get image file extension and use appropriate MIME type
      const ext = path.extname(resolvedImagePath).substring(1).toLowerCase();
      let mimeType;

      switch (ext) {
        case "jpg":
        case "jpeg":
          mimeType = "image/jpeg";
          break;
        case "png":
          mimeType = "image/png";
          break;
        case "gif":
          mimeType = "image/gif";
          break;
        case "svg":
          mimeType = "image/svg+xml";
          break;
        case "webp":
          mimeType = "image/webp";
          break;
        default:
          mimeType = `image/${ext}`;
      }

      // Read image file and convert to base64
      const imageBuffer = fs.readFileSync(resolvedImagePath);
      const base64Image = imageBuffer.toString("base64");
      const dataUri = `data:${mimeType};base64,${base64Image}`;

      // Replace image source with base64 data URI
      const newImgTag = imgTag.replace(`src="${imgSrc}"`, `src="${dataUri}"`);
      processedHtml = processedHtml.replace(imgTag, newImgTag);

      console.log(`Embedded image: ${path.basename(resolvedImagePath)}`);
    } else {
      console.log(
        `Warning: Image not found for embedding: ${resolvedImagePath}`
      );
    }
  }

  return processedHtml;
}

// Generate CSS for styling
function generateCSS() {
  return `
    <style>
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        line-height: 1.6;
        color: #333;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
      }
      
      /* Table of Contents */
      .toc-container {
        background-color: #f8f9fa;
        border: 1px solid #ddd;
        border-radius: 5px;
        padding: 15px;
        margin-bottom: 30px;
      }
      
      .toc {
        list-style-type: none;
        padding-left: 0;
      }
      
      .toc li {
        margin-bottom: 8px;
      }
      
      .toc-level-1 { padding-left: 0; }
      .toc-level-2 { padding-left: 20px; }
      .toc-level-3 { padding-left: 40px; }
      .toc-level-4 { padding-left: 60px; }
      .toc-level-5 { padding-left: 80px; }
      .toc-level-6 { padding-left: 100px; }
      
      /* Headings */
      h1, h2, h3, h4, h5, h6 {
        color: #2c3e50;
        font-weight: 600;
        margin-top: 1.5em;
        margin-bottom: 0.5em;
      }
      
      h1 { 
        font-size: 2.2em; 
        border-bottom: 2px solid #eaecef;
        padding-bottom: 10px;
      }
      
      h2 { 
        font-size: 1.8em; 
        border-bottom: 1px solid #eaecef;
        padding-bottom: 7px;
      }
      
      h3 { font-size: 1.5em; }
      h4 { font-size: 1.3em; }
      h5 { font-size: 1.2em; }
      h6 { font-size: 1.1em; }
      
      /* Code highlighting */
      pre.hljs {
        padding: 16px;
        overflow: auto;
        font-size: 0.9em;
        line-height: 1.45;
        background-color: #f6f8fa;
        border-radius: 6px;
        margin: 1em 0;
      }
      
      code:not(.hljs) {
        background-color: rgba(27, 31, 35, 0.05);
        border-radius: 3px;
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        font-size: 0.9em;
        padding: 0.2em 0.4em;
      }
      
      /* Tables */
      table {
        border-collapse: collapse;
        width: 100%;
        margin: 1em 0;
        overflow-x: auto;
        display: block;
      }
      
      table th {
        background-color: #f2f2f2;
        font-weight: 600;
        text-align: left;
      }
      
      table th, table td {
        border: 1px solid #dfe2e5;
        padding: 8px 12px;
      }
      
      table tr:nth-child(even) {
        background-color: #f6f8fa;
      }
      
      /* Images */
      img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 1em auto;
        border-radius: 5px;
      }
      
      /* For PDF page breaks */
      .page-break {
        page-break-after: always;
      }
      
      /* File headers */
      .file-header {
        background-color: #e1e4e8;
        border-radius: 5px 5px 0 0;
        padding: 10px 15px;
        font-weight: bold;
        margin-top: 30px;
      }
    </style>
  `;
}

// Traverse directory to find Markdown files
function traverseDirectory(useDirectory) {
  let mdFiles = [];
  function scanDir(directory) {
    fs.readdirSync(directory).forEach((file) => {
      const fullPath = path.join(directory, file);
      if (fs.statSync(fullPath).isDirectory()) {
        scanDir(fullPath);
      } else if (path.extname(fullPath) === ".md") {
        mdFiles.push(fullPath);
      }
    });
  }
  scanDir(useDirectory);
  return mdFiles;
}

// Convert Markdown to HTML
function convertToHtml(files, singleOutput = true, outputDir = "output") {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  if (singleOutput) {
    let allContent = "";
    let allHeadings = [];
    let allImagePaths = [];
    let allImageOutputPaths = [];

    files.forEach((file) => {
      const content = fs.readFileSync(file, "utf-8");
      allContent += `## ${path.basename(file)}\n\n${content}\n\n`;

      // Extract headings and add file context
      const fileHeadings = extractHeadings(content).map((heading) => {
        heading.text = `${heading.text} (${path.basename(file)})`;
        heading.id = slugify(`${heading.text}`, { lower: true, strict: true });
        return heading;
      });

      // Extract and process images
      const imagePaths = extractImagePaths(content);
      const newImagePaths = copyImages(file, imagePaths, outputDir);

      allImagePaths = [...allImagePaths, ...imagePaths];
      allImageOutputPaths = [...allImageOutputPaths, ...newImagePaths];
      allHeadings = allHeadings.concat(fileHeadings);
    });

    const toc = generateTOC(allHeadings);
    const htmlContent = md.render(allContent);
    const htmlWithIds = addHeadingIds(htmlContent, allHeadings);
    const htmlWithImages = processHtmlImagesForHtml(
      htmlWithIds,
      allImagePaths,
      allImageOutputPaths
    );

    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Markdown Documentation</title>
        ${generateCSS()}
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/github.min.css">
      </head>
      <body>
        <h1>Documentation</h1>
        ${toc}
        ${htmlWithImages}
      </body>
      </html>
    `;

    fs.writeFileSync(path.join(outputDir, "combined.html"), fullHtml);
  } else {
    files.forEach((file) => {
      const content = fs.readFileSync(file, "utf-8");
      const headings = extractHeadings(content);
      const toc = generateTOC(headings);
      const htmlContent = md.render(content);
      const htmlWithIds = addHeadingIds(htmlContent, headings);

      // Extract and process images
      const imagePaths = extractImagePaths(content);
      const newImagePaths = copyImages(file, imagePaths, outputDir);
      const htmlWithImages = processHtmlImagesForHtml(
        htmlWithIds,
        imagePaths,
        newImagePaths
      );

      const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${path.basename(file, ".md")}</title>
          ${generateCSS()}
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/github.min.css">
        </head>
        <body>
          <h1>${path.basename(file, ".md")}</h1>
          ${toc}
          ${htmlWithImages}
        </body>
        </html>
      `;

      fs.writeFileSync(
        path.join(outputDir, `${path.basename(file, ".md")}.html`),
        fullHtml
      );
    });
  }
}

// Convert Markdown to PDF
async function convertToPdf(files, singleOutput = true, outputDir = "output") {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Launch puppeteer with additional arguments for better image handling
  const browser = await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
    ],
  });

  const page = await browser.newPage();

  // Set viewport to ensure images are properly rendered
  await page.setViewport({
    width: 1200,
    height: 1600,
    deviceScaleFactor: 2, // Higher resolution for better image quality
  });

  if (singleOutput) {
    let allContent = "";
    let allHeadings = [];
    let allImagePaths = [];

    // First pass: collect all content and extract image paths
    files.forEach((file) => {
      const content = fs.readFileSync(file, "utf-8");
      allContent += `## ${path.basename(file)}\n\n${content}\n\n`;

      // Extract headings and add file context
      const fileHeadings = extractHeadings(content).map((heading) => {
        heading.text = `${heading.text} (${path.basename(file)})`;
        heading.id = slugify(`${heading.text}`, { lower: true, strict: true });
        return heading;
      });

      // Extract image paths for later processing
      const imagePaths = extractImagePaths(content);
      allImagePaths = [
        ...allImagePaths,
        ...imagePaths.map((p) => ({
          path: p,
          sourceFile: file,
        })),
      ];

      allHeadings = allHeadings.concat(fileHeadings);
    });

    const toc = generateTOC(allHeadings);
    const htmlContent = md.render(allContent);
    const htmlWithIds = addHeadingIds(htmlContent, allHeadings);

    // Convert rendered HTML with image tags to base64-embedded version
    console.log("Processing images for PDF embedding...");

    // Process HTML once with all file contexts
    let htmlWithBase64Images = htmlWithIds;

    // Use a single context for image resolution to prevent duplicate processing
    const baseDir = path.dirname(files[0]);
    for (const file of files) {
      htmlWithBase64Images = convertImagesToBase64(file, htmlWithBase64Images);
    }

    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Markdown Documentation</title>
        ${generateCSS()}
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/github.min.css">
      </head>
      <body>
        <h1>Documentation</h1>
        ${toc}
        ${htmlWithBase64Images}
      </body>
      </html>
    `;

    // Write intermediate HTML for debugging if needed
    const debugHtmlPath = path.join(outputDir, "debug-combined.html");
    fs.writeFileSync(debugHtmlPath, fullHtml);
    console.log(`Debug HTML written to ${debugHtmlPath}`);

    // Set content and wait for all resources to load
    await page.setContent(fullHtml, {
      waitUntil: ["load", "networkidle0"],
      timeout: 60000, // Increase timeout for larger documents
    });

    // Add a small delay to ensure all images are fully rendered
    // Use setTimeout with a promise instead of waitForTimeout which might not be available in all Puppeteer versions
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Generate PDF
    await page.pdf({
      path: path.join(outputDir, "combined.pdf"),
      format: options.paper,
      printBackground: true,
      margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
    });

    console.log(
      `Combined PDF generated at ${path.join(outputDir, "combined.pdf")}`
    );
  } else {
    for (let file of files) {
      console.log(`Processing ${path.basename(file)} for PDF conversion...`);

      const content = fs.readFileSync(file, "utf-8");
      const headings = extractHeadings(content);
      const toc = generateTOC(headings);

      // Extract image paths for better logging
      const imagePaths = extractImagePaths(content);
      if (imagePaths.length > 0) {
        console.log(
          `Found ${imagePaths.length} images in ${path.basename(file)}`
        );
      }

      const htmlContent = md.render(content);
      const htmlWithIds = addHeadingIds(htmlContent, headings);

      // Convert images to base64 for PDF embedding
      const htmlWithBase64Images = convertImagesToBase64(file, htmlWithIds);

      const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${path.basename(file, ".md")}</title>
          ${generateCSS()}
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/github.min.css">
        </head>
        <body>
          <h1>${path.basename(file, ".md")}</h1>
          ${toc}
          ${htmlWithBase64Images}
        </body>
        </html>
      `;

      // Write intermediate HTML for debugging if needed
      const debugHtmlPath = path.join(
        outputDir,
        `debug-${path.basename(file, ".md")}.html`
      );
      fs.writeFileSync(debugHtmlPath, fullHtml);
      console.log(`Debug HTML written to ${debugHtmlPath}`);

      // Set content and wait for all resources to load
      await page.setContent(fullHtml, {
        waitUntil: ["load", "networkidle0"],
        timeout: 30000, // Increase timeout
      });

      // Add a small delay to ensure all images are fully rendered
      // Use setTimeout with a promise instead of waitForTimeout which might not be available in all Puppeteer versions
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Generate PDF
      await page.pdf({
        path: path.join(outputDir, `${path.basename(file, ".md")}.pdf`),
        format: options.paper,
        printBackground: true,
        margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
      });

      console.log(`PDF generated for ${path.basename(file)}`);
    }
  }

  await browser.close();
}

// Command-line argument parsing
program
  .option(
    "-d, --directory <path>",
    "Directory containing Markdown files",
    "./markdowns"
  )
  .option("-f, --format <type>", "Output format: html or pdf", "html")
  .option(
    "-s, --single",
    "Generate a single output file instead of separate files",
    false
  )
  .option("-o, --output <path>", "Output directory", "output")
  .option("-p, --paper <size>", "Paper size for PDF: A4, Letter, Legal", "A4")
  .option(
    "-m, --remap <paths>",
    "Comma-separated list of path remappings in the format 'from:to'",
    ""
  );

program.parse(process.argv);
const options = program.opts();

// Process path remapping options if provided
if (options.remap) {
  const remapPairs = options.remap.split(",");
  imagePathConfig.pathMappings = [];

  remapPairs.forEach((pair) => {
    const [from, to] = pair.split(":");
    if (from && to) {
      // Create a regex that matches exactly the 'from' string
      const fromRegex = new RegExp(
        from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "g"
      );
      imagePathConfig.pathMappings.push({ from: fromRegex, to });
      console.log(`Added path remapping: ${from} -> ${to}`);
    }
  });
}

const markdownFiles = traverseDirectory(options.directory);
if (markdownFiles.length === 0) {
  console.error(`No markdown files found in ${options.directory}`);
  process.exit(1);
}

console.log(
  `Found ${markdownFiles.length} markdown files in ${options.directory}`
);

// Validate paper size option
if (options.format === "pdf") {
  const validPaperSizes = ["A4", "Letter", "Legal"];
  if (!validPaperSizes.includes(options.paper)) {
    console.error(
      `Invalid paper size: ${
        options.paper
      }. Valid options are: ${validPaperSizes.join(", ")}`
    );
    process.exit(1);
  }
}

if (options.format === "html") {
  convertToHtml(markdownFiles, options.single, options.output);
  console.log(`HTML files generated in ${options.output} directory`);
} else if (options.format === "pdf") {
  console.log(`Generating PDFs with paper size: ${options.paper}`);
  convertToPdf(markdownFiles, options.single, options.output)
    .then(() => {
      console.log(`PDF files generated in ${options.output} directory`);
    })
    .catch((err) => {
      console.error("Error generating PDFs:", err);
    });
} else {
  console.error('Invalid format. Use "html" or "pdf".');
}
