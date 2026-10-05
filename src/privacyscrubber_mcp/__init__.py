"""
@privacyscrubber/mcp-server (Python Entrypoint & Fallback)
Zero-Trust Data Sanitization (ZTDS) MCP Server.
"""

from .server import main

__version__ = "2.3.2"
__all__ = ["main", "__version__"]
