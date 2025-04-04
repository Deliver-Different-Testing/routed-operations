using Microsoft.EntityFrameworkCore;
using RunBuilder.Models;

namespace RunBuilder
{
    public class DynamicDespatchDbContext(DbContextOptions<DespatchContext> options) : DespatchContext(options)
    {
       
    }
}
