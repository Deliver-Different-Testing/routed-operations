using Microsoft.EntityFrameworkCore;

namespace RunBuilder.Models.Repository
{
    public class BaseRepository(IDbContextFactory<DynamicDespatchDbContext> contextFactory):IDisposable
    {
        private DynamicDespatchDbContext? _context;
        protected DynamicDespatchDbContext Context
        {
            get { return _context ??= contextFactory.CreateDbContext(); }
        }
        public void Dispose()
        {
            _context?.Dispose();
        }
    }
}
