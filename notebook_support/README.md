# Notebook reliability repairs

Scope: Qwen Image Edit, Wan 2.2 I2V/T2V, Z-Image GGUF/native, and TRELLIS notebook entry points, including their existing `notebooks/` copies. MiniMax and Krea2 are excluded.

The setup helper is embedded directly in each notebook: users do not have to download this directory. Existing Qwen backends and TRELLIS dependency variants are retained. `update_notebooks.py` documents the targeted migration; notebooks marked with the setup-guide ID are skipped on subsequent setup migrations.

Changes:

- Read keys from environment, Colab Secrets, or hidden input; remove the embedded Qwen credential and saved outputs.
- Check Python 3.12 and GPU availability before installing the existing prebuilt wheels. Qwen's Nunchaku entry point additionally checks its existing wheel's Torch 2.10 / CUDA 12.8 requirements.
- Download individual paid wheels with an Authorization header and install from temporary files. Redact failure logs; clean up temporary downloads.
- Stop setup on command failures. Preserve existing cloned repos rather than overwriting local edits.
- Retain TRELLIS dependency lists, select the existing A100/L4 path using the detected GPU, and mount Drive after successful installation.
- Install missing dependencies for the basic Wan/Z-Image examples and the Qwen launchers. Model checkpoints and generation settings are unchanged.
- Prompt for an I2V input image, validate it before model downloads, and retry only unexpected-keyword errors in the existing wrapper compatibility fallback.
- Stream Wan frames to ffmpeg rather than duplicating the entire raw video in memory. Preserve existing exports if encoding fails. Add output links and save the Z-Image GGUF PNG.

Run CPU regression tests with `python -m unittest discover -s notebook_support -p 'test_*.py' -v`.

Before publication, smoke-test each distinct backend on its supported Colab GPU: fresh setup, authenticated wheel download, model load, one output, saved output download, and setup rerun. These checks have not been performed on a live GPU. Rotate the credential previously embedded in the Qwen installer if it remains active; removing it here does not remove Git history or existing notebook copies.
