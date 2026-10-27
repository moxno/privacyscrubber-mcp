"""
@privacyscrubber/mcp-server (Python Entrypoint & Fallback)
Zero-Trust Data Sanitization (ZTDS) MCP Server.
"""

from .server import main

__version__ = "2.4.4"
__all__ = ["main", "__version__"]
