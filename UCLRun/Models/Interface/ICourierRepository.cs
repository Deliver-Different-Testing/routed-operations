using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace UCLRun.Models.Interface
{
    public interface ICourierRepository
    {
        IEnumerable GetPotentialCouriers();
    }
}
