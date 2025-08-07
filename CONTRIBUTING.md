## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Install dependencies**: `npm install`
4. **Set up environment**: Copy `env.example` to `.env` and configure
5. **Start development**: `npm run dev`

### Commit Messages
Use conventional commit format:
```
## Pull Request Process

1. **Create a feature branch** from `main`
2. **Make your changes** following the guidelines above
3. **Test thoroughly** - ensure functions work locally
4. **Update documentation** if needed
5. **Submit a pull request** with a clear description

## Project Structure

```
├── shared/              # Shared utilities
├── upload-documents/    # Document upload function
├── search-documents/    # Search function  
├── generate-response/   # AI response generation
├── examples/           # Usage examples
└── .github/           # GitHub workflows
```

## Environment Setup

For local development, you'll need:
- Azure Functions Core Tools v4
- Node.js 18+
- Azure AI Search service
- OpenAI API key (or Azure OpenAI)

## License

By contributing, you agree that your contributions will be licensed under the MIT License. 