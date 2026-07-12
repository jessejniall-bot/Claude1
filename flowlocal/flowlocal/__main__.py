"""Command-line entry point: `python -m flowlocal`."""

import argparse

from . import __version__, config as config_module


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="flowlocal",
        description="Local, private voice dictation for Windows (Wispr-Flow-style).",
    )
    parser.add_argument("--version", action="version", version=f"FlowLocal {__version__}")
    parser.add_argument(
        "--config", action="store_true", help="Print the config file path and exit"
    )
    parser.add_argument(
        "--devices", action="store_true", help="List audio input devices and exit"
    )
    args = parser.parse_args(argv)

    if args.config:
        print(config_module.ensure_exists())
        return

    if args.devices:
        from .audio import list_devices

        print(list_devices())
        return

    cfg = config_module.load()
    config_module.ensure_exists()

    # Imported here so --config / --devices / --help work even before the heavy
    # audio + model dependencies are installed.
    from .app import FlowLocalApp

    FlowLocalApp(cfg).run()


if __name__ == "__main__":
    main()
