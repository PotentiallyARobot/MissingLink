"""Apply targeted setup repairs; model configuration cells are preserved."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPERS = Path(__file__).with_name("runtime_setup.py").read_text(encoding="utf-8")
CPP = "stable_diffusion_cpp_python-0.4.5-cp312-cp312-linux_x86_64.whl"
NAMES = ["QWen_Image_Edit_MissingLink_Colab.ipynb", "Wan2_2_I2V_GGUF_MissingLink_Colab_Optimized.ipynb",
         "Wan2_2_T2V_GGUF_MissingLink_Colab_Optimized.ipynb", "ZImage_GGUF_MissingLink_Colab_Optimized.ipynb",
         "ZImage_MissingLink_Colab_Optimized.ipynb", "Trellis_2_MissingLink_Colab_Optimized.ipynb"]


def replace_source(cell, source):
    cell["source"] = source.splitlines(keepends=True)
    if cell["cell_type"] == "code":
        cell["outputs"] = []
        cell["execution_count"] = None


def update(path):
    nb = json.loads(path.read_text(encoding="utf-8"))
    if any(c.get("id") == "missinglink-setup-guide" for c in nb["cells"]):
        return
    cells = nb["cells"]
    for cell in cells:
        source = "".join(cell.get("source", []))
        if cell["cell_type"] == "code" and "os.environ" in source and "MISSING_LINK_TOKEN" in source and "!pip" in source:
            setup = HELPERS + '\n# Setup stops on failure; rerun safely after correcting the error.\nGPU_INFO = ml_preflight()\nTOKEN = ml_token()\n'
            if "Trellis" in path.name:
                setup += '''if "A100" in GPU_INFO.upper():
    MACHINE = "a100"
elif "L4" in GPU_INFO.upper():
    MACHINE = "l4"
else:
    raise RuntimeError("This TRELLIS notebook's tested setup targets A100 or L4. Select one of those GPUs before continuing.")
ml_install_tier(MACHINE)
'''
                # Retain existing dependency lists and checkout choices, with checked commands.
                matches = re.findall(r"!pip\s+(?:-q\s+)?install\s+([^\n]*)", source.replace("\\\n", " "))
                import shlex
                for match in matches:
                    args = shlex.split(match.replace("\\\n", " "))
                    if "-r" not in args:
                        setup += f'ml_run([sys.executable, "-m", "pip", "install"] + {args!r})\n'
                setup += 'ml_clone("https://github.com/PotentiallyARobot/TRELLIS.2.git", "/content/TRELLIS.2")\n'
                if "MissingLink-Extras.git" in source:
                    setup += 'ml_clone("https://github.com/PotentiallyARobot/MissingLink-Extras.git", "/content/MissingLink-Extras")\n'
                setup += '''# Drive is only mounted after successful setup, so failed installs need no Drive access.
if not os.path.exists("/content/drive/MyDrive"):
    from google.colab import drive
    drive.mount("/content/drive", force_remount=False)
os.makedirs("/content/images_in", exist_ok=True)
'''
            else:
                wheel = re.search(r"(nunchaku-[^\"\s]+\.whl|flash_attn-[^\"\s]+\.whl|stable_diffusion_cpp_python-[^\"\s]+\.whl)", source).group(1)
                if wheel.startswith("nunchaku"):
                    setup += '''import torch
if not torch.__version__.startswith("2.10.") or torch.version.cuda != "12.8":
    raise RuntimeError("This Nunchaku wheel requires PyTorch 2.10 / CUDA 12.8. Choose a matching runtime; setup has not replaced your Torch installation.")
'''
                setup += f'ml_install_wheel({wheel!r})\n'
                deps = ["huggingface_hub", "pillow", "numpy"]
                if "Wan" in path.name:
                    deps += ["ffmpeg-python"]
                    setup += 'ml_run(["apt-get", "-y", "install", "ffmpeg"])\n'
                if "QWen" in path.name:
                    deps += ["safetensors", "sentencepiece", "protobuf", "peft", "gguf>=0.10.0", "flask"]
                    if wheel.startswith("nunchaku"):
                        deps += ["diffusers", "transformers", "accelerate", "fastapi", "uvicorn", "einops"]
                    setup += 'ml_clone("https://github.com/PotentiallyARobot/MissingLink-Extras.git", "/content/MissingLink-Extras")\n'
                if path.name.startswith("ZImage_MissingLink"):
                    deps += ["diffusers", "transformers", "accelerate", "safetensors", "sentencepiece"]
                setup += f'ml_run([sys.executable, "-m", "pip", "install"] + {deps!r})\n'
            setup += 'print("Setup complete. Run the next model-loading or launch cell.")\n'
            replace_source(cell, setup)
        elif cell["cell_type"] == "code" and "generate_i2v_with_fallbacks" in source:
            source = source.replace('!pip install ffmpeg-python huggingface_hub pillow numpy', '# Dependencies were checked by the setup cell.')
            source = source.replace('INPUT_IMAGE_PATH = "/content/lavafloor.png"', 'INPUT_IMAGE_PATH = "/content/input.png"')
            start = source.index('if not os.path.exists(INPUT_IMAGE_PATH):')
            end = source.index('# --- model download ---', start)
            source = source[:start] + '''if not os.path.exists(INPUT_IMAGE_PATH):
    from google.colab import files
    print("Choose one source image to animate.")
    uploaded = files.upload()
    if len(uploaded) != 1:
        raise ValueError("Choose exactly one image, then rerun this cell.")
    import io
    with Image.open(io.BytesIO(next(iter(uploaded.values())))) as source_image:
        source_image.convert("RGB").save(INPUT_IMAGE_PATH)
# Validate input before spending time downloading models.
with Image.open(INPUT_IMAGE_PATH) as source_image:
    source_image.verify()

''' + source[end:]
            source = source.replace('except TypeError as e:\n            errors.append', 'except TypeError as e:\n            if "unexpected keyword argument" not in str(e):\n                raise  # Do not retry internal model failures as signature mismatches.\n            errors.append')
            replace_source(cell, source)
        elif cell["cell_type"] == "code" and path.name.startswith("ZImage_GGUF") and "display(img)" in source:
            source = source.replace('img = out[0]', 'if isinstance(out, (list, tuple)) and not out:\n    raise RuntimeError("No image returned. Check the model-loading output before retrying.")\nimg = out[0]')
            source += '\nfrom IPython.display import FileLink\nimg.save("/content/zimage_output.png")\ndisplay(FileLink("/content/zimage_output.png"))\n'
            replace_source(cell, source)
        elif cell["cell_type"] == "markdown" and "Wan" in path.name:
            source = source.replace("ZImage Image Generation Notebook", "Wan 2.2 Video Generation Notebook")
            if "T2V" in path.name:
                source = source.replace("Upload an image and change the prompt", "Change the text prompt")
            replace_source(cell, source)
    # Never retain old execution logs/credentials in distributable notebooks.
    for cell in cells:
        if cell["cell_type"] == "code":
            cell["outputs"] = []
            cell["execution_count"] = None
    cells.insert(1, {"cell_type":"markdown", "id":"missinglink-setup-guide", "metadata":{}, "source":[
        "## Start here\n", "1. Select the GPU recommended below before running setup. These wheels require Python 3.12.\n",
        "2. In Colab's key-shaped **Secrets** panel, add `MISSING_LINK_TOKEN` and enable notebook access. Setup also accepts a hidden prompt; never paste your key into a shared cell.\n",
        "3. Run setup first, then the model-loading/launch cell. If setup fails, fix the displayed error and rerun it before continuing. Existing repository checkouts are preserved.\n",
        "4. Download your outputs before disconnecting. Files under `/content` are temporary unless saved to mounted Drive. Colab GPU charges are separate from MissingLink access.\n"
    ]})
    path.write_text(json.dumps(nb, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Updated", path.relative_to(ROOT))


def update_video_export(path):
    nb = json.loads(path.read_text(encoding="utf-8"))
    helper = Path(__file__).with_name("video_export.py").read_text(encoding="utf-8")
    for cell in nb["cells"]:
        source = "".join(cell.get("source", []))
        if cell["cell_type"] != "code" or "def save_video_ffmpeg(" not in source:
            continue
        start = source.index("def save_video_ffmpeg(")
        end = source.index("\nsave_video_ffmpeg(frames", start)
        source = source[:start] + helper + "\n" + source[end:]
        if "from IPython.display import FileLink" not in source:
            output = "OUTPUT_MP4" if "I2V" in path.name else '"animate.mp4"'
            source += f"\nfrom IPython.display import FileLink\ndisplay(FileLink({output}))\n"
        replace_source(cell, source)
    path.write_text(json.dumps(nb, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    for name in NAMES:
        update(ROOT / name)
        update(ROOT / "notebooks" / name)
    update(ROOT / "Trellis.2-MissingLink-Colab-Optimized.ipynb")
    for name in NAMES:
        if name.startswith("Wan"):
            update_video_export(ROOT / name)
            update_video_export(ROOT / "notebooks" / name)
